/* amqp-chat.js
 * For this to work, node-amqp will need to be installed, and a local 
 * RabbitMQ server should be available with default credentials.
 * Usage:
 *   Run this script in multiple terminals, then begin chatting between 
 *   them.
 */
var amqp = require( 'amqp' ), amqp_stream = require( '../index.js' );

var connection = amqp.createConnection();
amqp_stream( {connection:connection, exchange:'chat.exchange'}, function ( err, chat_stream ) {
    process.stdin.pipe( chat_stream ).pipe( process.stdout );
});