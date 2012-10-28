var   tap           = require( 'tap' )
    , test          = tap.test
    , amqp          = require( 'amqp' )
;

// Running these tests assumes a default Rabbit install running locally
var amqp_url = 'amqp://guest:guest@localhost';
var connection1 = amqp.createConnection( {url:amqp_url} );
var connection2 = amqp.createConnection( {url:amqp_url} );

test( 'amqp-connection-stream', function ( t ) {

    AmqpStream = require( '../index.js' );
    t.ok( AmqpStream, "loaded" );

    t.test( 'amqp-connection-stream events', function ( t ) {
        //t.plan( 15 );

        var msgsRcvd = 0;
        var srcStream = AmqpStream( {connection:connection1, exchange:'amqp-stream.connection.test', autoBind:true, routingKey:'#'}, function ( err, s1 ) {
            t.equal( err, null, "no errors getting stream #1");
            t.ok( s1, "src stream connection established" );
            t.ok( s1.writable, "src stream is writable" );
            t.ok( s1.readable, "src stream is readable" );
            t.equal( s1.routingKey, '#', "src routingKey contains expected value" );

            var dstStream = AmqpStream( {connection:connection2, exchange:'amqp-stream.connection.test', autoBind:true, routingKey:'#'}, function ( err, s2 ) {
                t.equal( err, null, "no errors getting stream #2");
                t.ok( s2, "dst stream connection established" );
                t.ok( s2.writable, "dst stream is writable" );
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

                s1.on( 'data', function ( buff ) {
                    t.ok( true, 'got message on sending side, duplex working' );
                });

                setTimeout(function () {
                    s1.write( 'test msg' );
                    s1.write( 'test msg' );
                    s1.write( 'test msg' );

                    s2.write( 'test msg for sender, should not see this on receiving side' );

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
