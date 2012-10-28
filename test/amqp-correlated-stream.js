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
        , exchange2     = null
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
        t.plan( 2 );
        exchange1 = connection1.exchange( 'amqp-stream.connection.test', {durable: false, autoDelete: true}, function () {
            t.ok( exchange1, 'Got exchange #1' );
        });
        exchange2 = connection2.exchange( 'amqp-stream.connection.test', {durable: false, autoDelete: true}, function () {
            t.ok( exchange2, 'Got exchange #2' );
        });
    });

    t.test( 'amqp-exchange-stream events', function ( t ) {
        var srcNonCorrelatedMsgs = 0;
        var msgsRcvd = 0;
        var endsRcvd = 0;
        var errsRcvd = 0;
        var msgsRcvdCorrelated1 = 0;
        var endsRcvdCorrelated1 = 0;
        var errsRcvdCorrelated1 = 0;
        var msgsRcvdCorrelated2 = 0;
        var endsRcvdCorrelated2 = 0;
        var errsRcvdCorrelated2 = 0;
        var srcStream = AmqpStream( {exchange:exchange1, autoBind:true, routingKey:'#'}, function ( err, s1 ) {
            t.equal( err, null, "no errors getting stream #1");
            t.ok( s1, "src stream connection established" );
            t.ok( s1.writable, "src stream is writable" );
            t.ok( s1.readable, "src stream is readable" );
            t.equal( s1.routingKey, '#', "src routingKey contains expected value" );

            var dstStream = AmqpStream( {exchange:exchange2, autoBind:true, routingKey:'#'}, function ( err, s2 ) {
                t.equal( err, null, "no errors getting stream #2");
                t.ok( s2, "dst stream connection established" );
                t.ok( s2.writable, "dst stream is writable" );
                t.ok( s2.readable, "dst stream is readable" );
                t.equal( s2.routingKey, '#', "dst routingKey contains expected value" );

                srcStream.on( 'correlatedRequest', function ( cs ) {
                    t.ok( true, 'Got correlatedRequest event' );
                    cs.write( 'test data #1' );
                    cs.error( 'test error' );
                    cs.end( 'test end' );
                });

                cs1 = dstStream.createCorrelatedRequest(function ( err, cs ) {
                    cs.on( 'data', function (buf) {
                        msgsRcvdCorrelated1++;
                    }); 
                    cs.on( 'error', function () {
                        errsRcvdCorrelated1++;
                    });
                    cs.on( 'end', function () {
                        endsRcvdCorrelated1++;
                    });
                });

                cs2 = dstStream.createCorrelatedRequest(function ( err, cs ) {
                    cs.on( 'data', function (buf) {
                        msgsRcvdCorrelated2++;
                    }); 
                    cs.on( 'error', function () {
                        errsRcvdCorrelated2++;
                    });
                    cs.on( 'end', function () {
                        endsRcvdCorrelated2++;
                    });
                });

                dstStream.on( 'data', function ( buff ) {
                    msgsRcvd++;
                });
                dstStream.on( 'error', function ( buff ) {
                    errsRcvd++;
                    t.ok( true, 'got error event' );
                });
                dstStream.on( 'end', function ( buff ) {
                    endsRcvd++;
                    t.ok( true, 'got end event' );
                });

                srcStream.on( 'data', function ( buff ) {
                    srcNonCorrelatedMsgs++;
                });

                setTimeout(function () {
                    cs1.write( 'give me stuff' );
                    cs2.write( 'give me stuff' );
                    srcStream.write( 'this should not be seen in correlated requests' );
                    srcStream.error( 'error' );
                    
                    setTimeout(function () {
                        srcStream.end();
                        setTimeout(function () {
                            t.equal( msgsRcvd, 2, "non-correlated msg received count == 2" );  
                            t.equal( errsRcvd, 1, "non-correlated err received count == 1" );
                            t.equal( endsRcvd, 1, "non-correlated ends received count == 1" );

                            t.equal( msgsRcvdCorrelated1, 3, "correlated #1 msg received count == 3" );  
                            t.equal( errsRcvdCorrelated1, 1, "correlated #1 err received count == 1" );
                            t.equal( endsRcvdCorrelated1, 1, "correlated #1 ends received count == 1" );

                            t.equal( msgsRcvdCorrelated2, 3, "correlated #2 msg received count == 3" );  
                            t.equal( errsRcvdCorrelated2, 1, "correlated #2 err received count == 1" );
                            t.equal( endsRcvdCorrelated2, 1, "correlated #2 ends received count == 1" );

                            setTimeout(function () {
                                connection1.end();
                                connection2.end();
                                t.end(); 
                            }, 500);
                        }, 500);
                    }, 500);
                }, 500); 
            });
        });
    });

    t.end();
});
