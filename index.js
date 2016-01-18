require("babel-register");

var aggregate = require('./src/Aggregate');
var dynamoJournal = require('./src/DynamoJournal');
var memJournal = require('./src/MemJournal');
var Server = require('./src/server');

module.exports = {
  Aggregate: aggregate,
  DynamoJournal: dynamoJournal,
  MemJournal: memJournal,
  Journal: dynamoJournal,
  createServer: Server.createServer
};
