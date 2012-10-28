# node-amqp-stream

This is a flexible streaming interface for the node-amqp RabbitMQ client that 
aims to fully support node's streaming API. It can be used to create readable, 
writable, and duplex streams over amqp. This can help in chunking data for transport 
over amqp, but more importantly can be used to wire amqp listeners/providers into 
the expanding collection of node stream services.


## Installation

    npm install amqp-stream

## Synopsis

Example: A simple chat client using amqp-stream with pipes.

###chat.js

```javascript
var amqp = require( 'amqp' ), amqp_stream = require( 'amqp-stream' );

var connection = amqp.createConnection();
amqp_stream( {connection:connection, exchange:'chat.exchange'}, function ( err, chat_stream ) {
    process.stdin.pipe( chat_stream ).pipe( process.stdout );
});
```

Provided you have a RabbitMQ server running locally with default security settings, you can execute 
the above script in two separate terminals and begin communicating.

## Creating a Stream

###`amqp_stream(options [, callback])` 

`amqp_stream()` will return an instantiated amqp stream object. The new operator 
may also be used. Additionally, there is a createStream function that will also 
return an instantiated object. These three methods are all equal:

- `var stream = amqp_stream( ... )`
- `var stream = new amqp_stream( ... );`
- `var stream = amqp_stream.createStream( ... );` 

The exact behavior and features of an amqp stream will depend on the options passed 
at the time it is instantiated. The options are:

- `connection`: amqp.Connection, no default. 
    If set, must be an instance of amqp.Connection. The stream will use this connection 
    to declare named AMQP objects.
- `exchange`: amqp.Exchange || string, no default.
    If set, a writable/duplex stream will be returned. It must be either a string or an instance 
    of amqp.Exchange. If it is a string, then a connection must also be provided (see above).
- `routingKey`: string, default='#'. 
    The routingKey used for reads/writes (publish/subscribe). 
- `queue`: amqp.Queue || string || false, defaults to an exclusive queue. 
    If set, a readable/duplex stream will be returned. It must be either a string or an instance 
    of amqp.Queue. If it is a string, then a connection must also be provided (see above). If a 
    queue is not provided, then by default an exclusive queue will be created for reads. To over-ride 
    this behaviour, the option may be set to `false`. If a pre-bound amqp.Queue instance is provided, 
    and no exchange is provided in the option set, then the exchange that the queue object was 
    previously bound to will be used for writes. To avoid this behaviour, do not bind the queue before 
    creating the stream.
- `autoBind`: true|false, default=true. 
    If set, then then the associated queue will be bound to the specified exchange with the specified 
    routingKey when it is declared. This is the default. To over-ride this, autoBind must be set to 
    `false`. 
- `exchangeOptions`: {}  
    Options to be used when declaring the exchange.
- `queueOptions`: {}
    Options to be used when declaring the queue.
- `publishOptions`: {}
    Options to be used when publishing (writing) to the exchange.

When creating an amqp stream, the options provided must contain at least one node-amqp object: either 
an amqp.Connection, amqp.Exchange, or amqp.Queue. 

## Writable Streams

- `amqp_stream.write( buff|string [, encoding] )`
- `amqp_stream.error( buff|string [, encoding] )`
- `amqp_stream.end( buff|string [, encoding] )`

Writes to an amqp stream are published to the associated exchange / routing key. If publishOptions 
were provided at initialization time, they are used. 

### Headers

There are two headers used by amqp-stream. x-stream-origin and x-stream-event. These headers are used 
to track message origins and payload types going across the amqp bus, so that the receiver on the other 
end can emit the message correctly to it's listeners. 

## Readable Streams

- `amqp_stream.on( 'data', function (buf) {})`
- `amqp_stream.on( 'error', function () {})`
- `amqp_stream.on( 'end', function () {})`
- `amqp_stream.pause()`
- `amqp_stream.resume()`

All data received by the amqp stream's associated queue will be emitted, provided the message did not originate 
from the stream object itself (in duplex streams).

## Duplex Streams

Duplex amqp streams provide both readable and writable capabilities described above. One important note 
is that when writing to a duplex stream, the data being sent will not be emitted locally, even though 
the local queue will receive the message. The x-stream-origin header is used to identify this situation and 
discard the data.

## Correlated Streams

AMQP (at least RabbitMQ) makes use of several options for RPC-like behaviour, and in situations where a 
response must be matched with a request. Exclusive queues combined with correlationId and replyTo are used 
to achieve this.

In amqp-stream, this is handled via correlated streams, which are created from an existing amqp stream. When 
a write occurs on a correlated stream, the message goes out with the appropriate correlationId/replyTo, and a 
special event is emitted on the receiving end using amqp-stream containing a new "sub stream". Writes to this new 
stream are sent back to the correlated stream created locally. It's easier in practice than it is to explain, so 
here's an example:

###amqp-rpc-server.js

```javascript
var amqp = require( 'amqp' ), amqp_stream = require( 'amqp-stream' );

var connection = amqp.createConnection();
amqp_stream( {connection:connection, exchange:'rpc', routingKey:'upper'}, function ( err, rpc_stream ) {
    rpc_stream.on( 'correlatedRequest', function (correlatedStream) {
        correlatedStream.on( 'data', function (buf) {
            correlatedStream.write( buf.toString().toUpperCase() );
            correlatedStream.end();
        });
    });
});
```

###amqp-rpc-client.js

```javascript
var amqp = require( 'amqp' ), amqp_stream = require( 'amqp-stream' );

var connection = amqp.createConnection();
amqp_stream( {connection:connection, exchange:'rpc', routingKey:'upper'}, function ( err, rpc_stream ) {
    rpc_stream.createCorrelatedRequest(function ( err, upper ) {
        upper.on( 'data', function (buf) { console.log(buf.toString()) });
        upper.on( 'end', connection.end.bind( connection ) );
        upper.write( process.argv[2] );
    });
});
```

###`amqp_stream.createCorrelatedRequest([correlationId] [, callback])`

Sets up a new correalted stream

- `correlationId` string, optional
    A custom correlationId may be provided, otherwise one will be generated automatically. 
- `callback(err, correlated_stream)` function, optional
    If a callback is provided, it will be executed with (err,stream) arguments once the 
    correlated stream is ready.

###`amqp_stream.on('correlatedRequest', callback)`

The correlatedRequest event is emitted on amqp_streams receiving the correlated request. 
The callback is executed and passed a single argument - a duplex stream created via 
`createCorrelatedResponse`.


## Integration With Other Stream Modules

The primary reason for amqp-stream existing is to enable the many great node modules that rely 
on node's stream api to operate over amqp. 

### Scuttlebutt

Scuttlebutt is an awesome node module that can be used to replicate data structures between 
nodes via streams. Here's an example of using crdt (a subclass of scuttlebutt) over amqp-stream. 
A more comprehensive example (with some basic output), along with other examples, can be found in 
the examples directory.

###amqp-crdt-replication.js

```javascript
var   amqp          = require( 'amqp' )
    , amqp_stream   = require( 'amqp-stream' )
    , Doc           = require('crdt').Doc
;

var   connection    = amqp.createConnection()
    , ReplicatedDoc = new Doc()
;

amqp_stream( {connection:connection, exchange:'scuttlebutt', routingKey:'document.stream'}, function ( err, doc_stream ) {
    var rs;
    (rs = ReplicatedDoc.createStream())
        .pipe(doc_stream)
        .pipe(rs);
});
```

### Dnode

Dnode is an RPC client for node that wires client and servers up via streams (net sockets by default). 
It is possible to run dnode over amqp-stream, though there's a few things to note.

###amqp-dnode-server.js

```javascript
var   dnode         = require( 'dnode' )
    , amqp          = require( 'amqp' )
    , amqp_stream   = require( 'amqp-stream' )
;

var   connection    = amqp.createConnection();
amqp_stream( {connection:connection, exchange:'dnode'}, function ( err, rpc_stream ) {
    rpc_stream.on( 'correlatedRequest', function (cstream) {
        var d = dnode({
            transform : function (s, cb) {
                cb(s.replace(/[aeiou]{2,}/, 'oo').toUpperCase())
            }
        });
        cstream.pipe(d).pipe(cstream);
    });
});
```

###amqp-dnode-client.js

```javascript
var   dnode         = require( 'dnode' )
    , amqp          = require( 'amqp' )
    , amqp_stream   = require( 'amqp-stream' )
;

var   connection    = amqp.createConnection()
    , d             = dnode();

amqp_stream( {connection:connection, exchange:'dnode'}, function ( err, rpc_stream ) {
    rpc_stream.createCorrelatedRequest(function (err, cstream) {
        d.on('remote', function (remote) {
            remote.transform('beep', function (s) {
                console.log('beep => ' + s);
                d.end();
            });
        });
        cstream.on( 'end', connection.end.bind(connection) );
        cstream.pipe(d).pipe(cstream);
        
        /* This write forces the correlated stream to be initialized on remote side and prompts 
         * dnode server to send us the remote interface
         */ 
        cstream.write();
    });
});
```

Note, that we do an empty write in the client. Because dnode expects the server to deliver 
the remote interface upon connection, and amqp doesn't emulate socket connections very well, 
we use a correlated stream which does fire an event on the remote side, but it does not fire 
until the first message (stream write) comes through. By doing an empty write, we trigger 
the correlatedRequest event on the remote side which sets up our dnode pipes properly.
