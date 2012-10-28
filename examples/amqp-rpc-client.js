/* amqp-rpc-client.js
 * For this to work, node-amqp will need to be installed.
 * Usage:
 *   First run amqp-rpc-server.js in another terminal, then:
 *   node amqp-rpc-client boom
 */
var amqp = require( 'amqp' ), amqp_stream = require( '../index.js' );

var connection = amqp.createConnection();
amqp_stream( {connection:connection, exchange:'rpc', routingKey:'upper'}, function ( err, rpc_stream ) {
    rpc_stream.createCorrelatedRequest(function ( err, upper ) {
        upper.on( 'data', function (buf) { console.log(buf.toString()) });
        upper.on( 'end', connection.end.bind( connection ) );
        upper.write( process.argv[2] );
    });
});