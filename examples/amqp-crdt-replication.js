/* amqp-crdt-replication.js
 * For this to work, node-amqp and crdt will need to be installed.
 * Usage:
 *   Run this script in multiple terminals with one argument (must 
 *   be different in each), and watch as updates from all running 
 *   scripts are shown in each terminal. Document replication over 
 *   AMQP via Scuttlebutt!
 */
var   amqp          = require( 'amqp' )
    , amqp_stream   = require( '../index.js' )
    , Doc           = require('crdt').Doc
;

var   connection    = amqp.createConnection()
    , ReplicatedDoc = new Doc()
    , myName        = process.argv[2]
;

amqp_stream( {connection:connection, exchange:'scuttlebutt', routingKey:'document.stream'}, function ( err, doc_stream ) {
    var rs;
    (rs = ReplicatedDoc.createStream())
        .pipe(doc_stream)
        .pipe(rs);
});

// Replication setup is complete, now just do something to the document
// For example:
var myRecord = ReplicatedDoc.set( myName, {create: new Date().toUTCString()} );
setInterval( function () {
    myRecord.set( {updated: new Date().toUTCString()} );
}, 5000);

// When a document is updated locally or remotely, show the change
ReplicatedDoc.on( 'row_update', function (row) {
    console.log( row.toJSON() );
});