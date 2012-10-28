/* amqp-dnode-client.js
 * For this to work, node-amqp and dnode will need to be installed.
 * Usage:
 *   Run this script after running the server counterpart. The output 
 *   will be beed => BOOP, provided a local RabbitMQ server is available.
 */
var   dnode         = require( 'dnode' )
    , amqp          = require( 'amqp' )
    , amqp_stream   = require( '../index.js' )
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
