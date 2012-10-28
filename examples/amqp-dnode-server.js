/* amqp-dnode-server.js
 * For this to work, node-amqp and dnode will need to be installed.
 * Usage:
 *   Run this script before running the client counterpart.
 */
var   dnode         = require( 'dnode' )
    , amqp          = require( 'amqp' )
    , amqp_stream   = require( '../index.js' )
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
