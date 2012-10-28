/* amqp-rpc-server.js
 * For this to work, node-amqp will need to be installed.
 * This rpc server listens for correlated requests on exchange rcp.upper 
 * and responds with the upper-case version of any string written. 
 */
var amqp = require( 'amqp' ), amqp_stream = require( '../index.js' );

var connection = amqp.createConnection();
amqp_stream( {connection:connection, exchange:'rpc', routingKey:'upper'}, function ( err, rpc_stream ) {
    rpc_stream.on( 'correlatedRequest', function (correlatedStream) {
        correlatedStream.on( 'data', function (buf) {
            correlatedStream.write( buf.toString().toUpperCase() );
            correlatedStream.end();
        });
    });
});