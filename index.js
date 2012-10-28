var   util          = require( 'util'   )
    , assert        = require( 'assert' )
    , Stream        = require( 'stream' )
;

/* AmqpStream ( options, callback )
 * 
 */
var AmqpStream = function ( options, callback ) {
    
    if ( typeof options == 'function' && typeof callback != 'function' ) {
        callback = options;
    }
    var callback = callback || function (){};

    // Validate arguments
    if ( typeof options != 'object' || options.constructor != Object ) {
        callback( Error( 'AmqpStream requires the first argument to an options object.' ) );
        return false;
    }

    // If module was called as a function, return a new AmqpStream object
    if ( !(this instanceof AmqpStream) ) 
        return new AmqpStream( options, callback );

    // Variables / Properties
    var stream          = this;
    var err             = null;

    // Make sure we have a valid connection
    if ( !(amqpObjectType(options.connection)=='Connection') && !(amqpObjectType(options.exchange)=='Exchange') && !(amqpObjectType(options.queue)=='Queue') ) {
        callback( Error( 'AmqpStream requires at least one amqp object (Connection, Exchange, or Queue).' ) );
        return false;
    }

    // Determine connection bearing object
    var connection = amqpObjectType(options.connection)=='Connection' ? options.connection : 
        amqpObjectType(options.exchange)=='Exchange' ? options.exchange.connection :
        amqpObjectType(options.queue)=='Queue' ? options.queue.connection : null;

    // AMQP related configuration properties
    this.connection     = null;
    this.exchange       = null;
    this.queue          = null;
    this.routingKey     = options.routingKey || '#';
    this.ctag           = null;
    this.originId       = uniqueIdentifier();
    this.autoBind       = typeof options.autoBind != 'undefined' ? options.autoBind : true;

    this.correlations   = [];
    //this.correlationId  = (options.correlationId && options.correlationId === true) ? uniqueIdentifier() : (options.correlationId || null);

    this.publishOptions         = options.publishOptions || {};
    this.publishOptions.headers = this.publishOptions.headers || {};
    this.publishOptions.headers['x-stream-origin'] = this.originId;

    // Stream interface properties
    this.writable       = false;    // Enabled once exchange is set
    this.readable       = false;
    this.paused         = false;    // Start in an un-paused state
    this.ended          = false;
    this.destroyed      = false;
    this.buffer         = [];

    this.initializing   = true;

    var connectionReady = false;
    var exchangeReady   = false;
    var queueReady      = false;
    var onReady = function () {
        if ( stream.initializing && connectionReady && (exchangeReady || !options.exchange) && (queueReady || (typeof options.queue != 'undefined' && options.queue === false) ) ) {
            stream.initializing = false;
            callback( err, stream );
            process.nextTick( function () { stream.emit( 'ready' ); } );
        }
    }

    var configureStream = function ( connection, options ) {
        var connectionReady = function () {
            setConnection( connection );

            if ( amqpObjectType(options.exchange) == 'Exchange' ) setExchange( options.exchange );
            else if ( options.exchange && typeof options.exchange == 'string' ) {
                connection.exchange( options.exchange, options.exchangeOptions||{durable:false,autoDelete:true}, function (exchange) {
                    setExchange( exchange );
                });
            } 

            if ( amqpObjectType(options.queue) == 'Queue' ) { 
                if ( !options.exchange && options.queue.exchange ) {
                    options.exchange = options.queue.exchange;
                    setExchange( options.exchange );
                }
                setQueue( options.queue );
            }
            else if ( options.queue && typeof options.queue == 'string' ) {
                connection.queue( options.queue, options.queueOptions||{durable:false,autoDelete:true}, function (queue) {
                    setQueue( queue );
                });
            }
            // Skip binding to a queue if queue:false, will create write-only stream 
            else if ( typeof options.queue != 'undefined' && options.queue === false ) {
                options.queue = null;
            }
            else {
                options.queue = buildQueue();
            }

        }
        if ( !connection._connecting && connection.channels && Object.keys(connection.channels).length > 0 ) {
            connectionReady();
        }
        else {
            connection.on( 'ready', connectionReady );
        }
    }

    var setConnection = function ( connection ) {
        stream.connection = connection;
        stream.emit( 'connectionReady' );

        connectionReady = true;
        onReady();
    }
    var setExchange = function ( exchange ) {
        if ( stream.exchange )
            return;
        assert.equal( amqpObjectType(exchange), 'Exchange', 'setExchange expected an Exchange object' );
        stream.exchange = exchange;
        stream.writable = true;
        stream.emit( 'exchangeReady' );
        stream.exchange.on( 'error', function (err) { stream.emit( 'error', err); });

        exchangeReady = true;
        onReady();
    }
    var setQueue = function ( queue ) {
        if ( stream.queue ) 
            return;
        assert.equal( amqpObjectType(queue), 'Queue', 'setQueue expected a Queue object' );
        stream.queue = queue;
        stream.readable = true;
        stream.emit( 'queueReady' );
        queue.on( 'error', function (err) { stream.emit( 'error', err); });
        queue.subscribe( messageHandler ).addCallback( function(ok) { 
            stream.ctag = ok.consumerTag;
        });

        // if ( stream.correlationId ) {
        //     stream.publishOptions.replyTo = queue.name;
        //     stream.publishOptions.correlationId = stream.correlationId;
        // }

        queueReady = true;
        onReady();
    }
    var buildQueue = function ( ) {
        var queue = stream.connection.queue( '', {durable: false, exclusive: true, autoDelete: true}, function () {
            if ( stream.autoBind )
                queue.bind( stream.exchange, stream.routingKey );
            queue.bind( stream.exchange, queue.name );
            queue.on( 'queueBindOk', function () { setQueue(queue); });
        });
        return queue;
    }
    var onEnd = function () {
        stream.writable = stream.readable  = false;
        stream.ended = true;
        stream.emit( 'end' );
    }
    var messageHandler = function ( message, headers, deliveryInfo ) {
        if ( 'x-stream-origin' in headers && headers['x-stream-origin'] == stream.originId )
            return; // Do not emit our own writes ( this is for duplex streams )
        if ( deliveryInfo.correlationId ) {
            if ( deliveryInfo.correlationId in stream.correlations ) {
                var emitter = stream.correlations[ deliveryInfo.correlationId ];
            }
            else {
                var emitter = stream.createCorrelatedResponse( deliveryInfo.replyTo, deliveryInfo.correlationId, function ( err, emitter ) {
                    stream.emit( 'correlatedRequest', emitter );
                });
            }
            if ( 'x-stream-event' in headers && headers['x-stream-event'] == 'end') {
                if ( message.data && message.data.toString().trim() != '' )
                    emitter.emit( 'data', message.data );
                emitter.emit( 'end' );
                process.nextTick( function () { delete stream.correlations[deliveryInfo.correlationId] } );
            }
        }
        else {
            var emitter = stream;
            if ( 'x-stream-event' in headers && headers['x-stream-event'] == 'end' ) {

                if ( message.data && message.data.toString().trim() != '' )
                    emitter.emit( 'data', message.data );

                if( !( emitter.paused || emitter.buffer.length ) )
                    return onEnd();
                else
                    emitter.once( 'drain', onEnd );
                emitter.drain();
            }
        }
        
        if ( 'x-stream-event' in headers && headers['x-stream-event'] == 'error') {
            if ( message.data && message.data.toString().trim() != '' )
                emitter.emit( 'data', message.data );
            emitter.emit( 'error' );
        }
        else if ( ( !('x-stream-event' in headers) || ('x-stream-event' in headers && headers['x-stream-event'] == 'data') ) && 
            message.data && message.data.toString().trim() != '' 
        ) {
            if ( emitter.paused ) {
                emitter.buffer.push( message.data );
            }
            else {
                emitter.emit( 'data', message.data );
            }
        }
    }

    var _DISABLED = function () {
        // If a queue was not provided, we will not listen by default, but if 
        // a listener is bound, we will create an exclusive queue to start listening on
        var bindOnDemand = function ( ev, fn ) {
            // Is this stream was build from a connection, connection/exchange may not be ready yet
            if ( stream.queue && typeof stream.queue == 'object' ) {
                stream.removeListener( 'newListener', bindOnDemand );
                return;
            }
            if ( stream.exchange && stream.exchange.state && stream.exchange.state == 'open' ) {
                if ( [ 'data', 'error', 'end' ].indexOf( ev ) != (-1) ) {
                    if ( stream.exchange && !stream.queue ) {
                        buildQueue();
                    }
                    stream.removeListener( 'newListener', bindOnDemand );
                }
            } else {
                stream.on( 'exchangeReady', bindOnDemand );
            }
        }
        this.on( 'newListener', bindOnDemand );
    }

    // Configure the stream
    configureStream( connection, options );
}
util.inherits( AmqpStream, Stream );

// TODO: Can we sanely support back-pressure here (return false, emit drain), does it even matter w/ amqp?
AmqpStream.prototype.write = function ( buf, enc, routingKey, _addOpts ) {
    if ( routingKey && !_addOpts )
        var _addOpts = routingKey, routingKey = null;
    if ( !this.writable )
        this.emit( 'error', Error( 'Non-writable amqp stream.' ) );
    else {
        if ( typeof buf == 'string' ) {
            var buf = new Buffer( buf, enc );
        }
        var options = {};
        for (var opt in this.publishOptions) options[opt] = this.publishOptions[opt];
        if (_addOpts) for ( opt in _addOpts ) options[opt] = _addOpts[opt];
        options.headers['x-stream-event'] = 'data';
        this.exchange.publish( routingKey || this.routingKey, buf || ' ', options );
    }
}
AmqpStream.prototype.end = function ( buf, enc, _addOpts ) {
    if ( routingKey && !_addOpts )
        var _addOpts = routingKey, routingKey = null;

    if ( !this.writable && !this.ended )
        this.emit( 'error', Error( 'Non-writable amqp stream.' ) );
    else {
        if ( typeof buf == 'string' ) {
            var buf = new Buffer( buf, enc );
        }
        var options = {};
        for (var opt in this.publishOptions) options[opt] = this.publishOptions[opt];
        if (_addOpts) for ( opt in _addOpts ) options[opt] = _addOpts[opt];
        options.headers['x-stream-event'] = 'end';
        this.exchange.publish( this.routingKey, buf || ' ', options );

        this.ended = true;
        if ( this.ctag && this.queue )
            this.queue.unsubscribe( this.ctag );

        process.nextTick( this.destroy.bind(this) );
    }
}
AmqpStream.prototype.endCorrelation = function ( buf, enc, routingKey, _addOpts ) {
    if ( routingKey && !_addOpts )
        var _addOpts = routingKey, routingKey = null;

    if ( typeof buf == 'string' ) {
        var buf = new Buffer( buf, enc );
    }
    var options = {};
    for (var opt in this.publishOptions) options[opt] = this.publishOptions[opt];
    if (_addOpts) for ( opt in _addOpts ) options[opt] = _addOpts[opt];
    options.headers['x-stream-event'] = 'end';
    this.exchange.publish( routingKey || this.routingKey, buf || ' ', options );
}
AmqpStream.prototype.error = function ( buf, enc, routingKey, _addOpts ) {
    if ( routingKey && !_addOpts )
        var _addOpts = routingKey, routingKey = null;
    if ( typeof buf == 'string' ) {
        var buf = new Buffer( buf, enc );
    }
    var options = {};
    for (var opt in this.publishOptions) options[opt] = this.publishOptions[opt];
    if (_addOpts) for ( opt in _addOpts ) options[opt] = _addOpts[opt];
    options.headers['x-stream-event'] = 'error';
    this.exchange.publish( routingKey || this.routingKey, buf || ' ', options );
}
// TODO: I feel like we can do better at unbinding/unsubscribing here. but may not be needed 
// due to autoDelete
AmqpStream.prototype.destroy = function ( ) {
    this.writable = this.readable  = false;
    this.destroyed = this.ended = true;
    this.buffer.length = 0;
    this.emit( 'close' );
}
/* Pause/Resume support for read-side of stream
 * Thanks to dominictarr for this logic, it just buffers in memory like pause-stream
 */
// TODO: We should be able to pause data coming in from amqp here instead of buffering in memory 
// but I took the easy way out for now
AmqpStream.prototype.pause = function () {
    this.paused = true;
}
AmqpStream.prototype.resume = function () {
    this.paused = false;
    this.drain();
}
AmqpStream.prototype.drain = function () {
    while( !this.paused && this.buffer.length )
        this.emit( 'data', this.buffer.shift() );
}

/* createCorrelatedRequest
 * This function returns a "sub stream" on duplex streams where writes are published with a correlation 
 * ID, and emits only occur when incoming messages contain a matching correlation ID
 */
AmqpStream.prototype.createCorrelatedRequest = function ( correlationId, callback ) {
    if ( typeof correlationId == 'function' ) 
        var callback = correlationId, correlationId = null;

    var   stream = this
        , err = null
    ;
    if ( !stream.queue ) 
        callback( Error('Cannot create correlated request on non-readable amqp stream.') );

    var correlationId = correlationId || uniqueIdentifier();
    var substream = new Stream;
    substream.readable = true;
    substream.writable = true;
    substream.paused = false;
    substream.write = function ( buf, enc ) {
        stream.write( buf, enc, {replyTo:stream.queue.name, correlationId:correlationId} );
    }
    substream.error = function ( buf, enc ) {
        stream.error( buf, enc, {replyTo:stream.queue.name, correlationId:correlationId} );
    }
    substream.end = function ( buf, enc ) {
        stream.endCorrelation( buf, enc, {replyTo:stream.queue.name, correlationId:correlationId} );
        process.nextTick( function () {
            substream.emit( 'end' );
            delete stream.correlations[ correlationId ];
        });
    }
    // TODO: Implement pause/resume on correlated streams
    substream.pause = function () {}
    substream.pause = function () {}

    stream.correlations[correlationId] = substream;
    callback( err, substream );
    return substream;
}
AmqpStream.prototype.createCorrelatedResponse = function ( routingKey, correlationId, callback ) {
    if ( typeof correlationId == 'function' ) 
        var callback = correlationId, correlationId = true;

    var   stream = this
        , err = null
    ;
    if ( !stream.queue ) 
        callback( Error('Cannot create correlated request on non-readable amqp stream.') );

    var substream = new Stream;
    substream.readable = true;
    substream.writable = true;
    substream.paused = false;
    substream.write = function ( buf, enc ) {
        stream.write( buf, enc, routingKey, {correlationId:correlationId} );
    }
    substream.error = function ( buf, enc ) {
        stream.error( buf, enc, routingKey, {correlationId:correlationId} );
    }
    substream.end = function ( buf, enc ) {
        stream.endCorrelation( buf, enc, routingKey, {correlationId:correlationId} );
        process.nextTick( function () {
            substream.emit( 'end' );
            delete stream.correlations[ correlationId ];
        });
    }
    // TODO: Implement pause/resume on correlated streams
    substream.pause = function () {}
    substream.pause = function () {}

    stream.correlations[correlationId] = substream;
    callback( err, substream );
    return substream;
}

/* createStream
 * Convenience function that matches some node conventions, same as: new AmqpStream, or just AmqpStream
 */
 AmqpStream.createStream = function () {
    return AmqpStream.apply( null, arguments );
 }

module.exports = AmqpStream;

/* amqpObjectType
 * Helper function that identifies object types from the node amqp module
 * Could probably do better, but do not want to require amqp locally so trying to avoid 
 * instanceof.
 */
function amqpObjectType( instance ) {
    if ( instance && instance.subscribeRaw )
        return 'Queue';
    if ( instance && instance.cleanup )
        return 'Exchange';
    if ( instance && instance.addListener )
        return 'Connection';
    return null;
}

/* uniqueIdentifier
 * Used to create a unique identifiers for use in x-stream-origin header value, so that in a duplex
 * amqp stream, write will not emit messages locally, and for correlation ID's.
 */
function uniqueIdentifier( ) {
    return Math.floor(Math.random() * 1000000).toString(36).toUpperCase() + (new Date).getTime().toString(36).toUpperCase();
}
