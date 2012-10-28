var   tap           = require( 'tap' )
    , test          = tap.test
    , amqp          = require( 'amqp' )
;

// Running these tests assumes a default Rabbit install running locally
var amqp_url = 'amqp://guest:guest@localhost';

test('amqp-exchange-stream', function (t) {
    AmqpStream = require( '../index.js' );
    t.ok( AmqpStream, "loaded" );

    var   connection1   = null
        , connection2   = null
        , exchange1     = null
        , queue1        = null
    ;
    
    t.test( 'get connections', function ( t ) {
        t.plan( 2 );
        connection1 = amqp.createConnection( {url:amqp_url} );
        connection2 = amqp.createConnection( {url:amqp_url} );
        connection1.on( 'ready', function () {
            t.ok( connection1, 'Got connection #1');
        });
        connection2.on( 'ready', function () {
            t.ok( connection2, 'Got connection #2');
        });
    });

    t.test( 'get exchanges', function ( t ) {
        t.plan( 1 );
        exchange1 = connection1.exchange( 'amqp-stream.connection.test', {durable: false, autoDelete: true}, function () {
            t.ok( exchange1, 'Got exchange #1' );
        });
    });

    t.test( 'get queue', function ( t ) {
        t.plan( 2 );
        queue1 = connection2.queue( '', {durable: false, exclusive: true, autoDelete: true}, function () {
            t.ok( queue1, 'Got queue #1' );
            queue1.bind( 'amqp-stream.connection.test', '#' );
            queue1.on( 'queueBindOk', function () {                
                t.ok( queue1, 'Bound queue #1' );
            });
        });
    });

    t.test( 'amqp-exchange-stream events', function ( t ) {
        var msgsRcvd = 0;
        var srcStream = AmqpStream( {exchange:exchange1, autoBind:true, routingKey:'#'}, function ( err, s1 ) {
            t.equal( err, null, "no errors getting stream #1");
            t.ok( s1, "src stream connection established" );
            t.ok( s1.writable, "src stream is writable" );
            t.ok( s1.readable, "src stream is readable" );
            t.equal( s1.routingKey, '#', "src routingKey contains expected value" );

            var dstStream = AmqpStream( {queue:queue1}, function ( err, s2 ) {
                t.equal( err, null, "no errors getting stream #2");
                t.ok( s2, "dst stream connection established" );
                t.equal( s2.writable, false, "dst stream is NOT writable" );
                t.ok( s2.readable, "dst stream is readable" );
                t.equal( s2.routingKey, '#', "dst routingKey contains expected value" );

                s2.on( 'data', function ( buff ) {
                    msgsRcvd++;
                });
                s2.on( 'error', function ( buff ) {
                    t.ok( true, 'got error event' );
                });
                s2.on( 'end', function ( buff ) {
                    t.ok( true, 'got end event' );
                });

                setTimeout(function () {
                    s1.write( 'test msg' );
                    s1.write( 'test msg' );
                    s1.write( 'test msg' );

                    setTimeout(function () {
                        t.equal( msgsRcvd, 3, "msg received count == 3" );  

                        s2.pause();
                        s1.write( 'test msg' );
                        setTimeout(function () {
                            t.ok( s2.buffer.length > 0, 'pause buffer on receiving side > 0' );
                            s2.resume();
                            setTimeout(function () {
                                t.ok( s2.buffer.length == 0, 'pause buffer clean after resume' );
                                s1.error( 'testing error event' );
                                s1.end( 'testing end event' );
                                setTimeout(function () {
                                    s1.destroy();
                                    s2.destroy();
                                    connection1.end();
                                    connection2.end();
                                    t.end(); 
                                }, 1000);
                            }, 500);
                        }, 500);
                    }, 500);
                }, 500); 
            });
        });
    });

    t.end();
});
