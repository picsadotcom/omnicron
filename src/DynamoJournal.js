import AWS from "aws-sdk";
import dynamoStreams from "dynamo-streams";
import Debug from 'debug';
import Promise from 'bluebird';

const debug = Debug('omnicron:dynamojournal');

const isDate = (value) => toString.call(value) === '[object Date]';
const isObject = (value) => value !== null && typeof value === 'object';

const DynamoJournal = {

  init({table = 'events', awsConfigPath, awsConfig} = {}){
    debug('init() table: ', table);
    if (awsConfigPath) {
      AWS.config.loadFromPath(awsConfigPath);
    }
    else {
      AWS.config.update(awsConfig);
    }

    this._table = table;
    this._db = new AWS.DynamoDB.DocumentClient();
    return this._createTable(table);
  },

  _createTable(table){
    var params = {
        TableName : table,
        KeySchema: [
            { AttributeName: "stream", KeyType: "HASH"},
            { AttributeName: "seq", KeyType: "RANGE" }
        ],
        AttributeDefinitions: [
            { AttributeName: "stream", AttributeType: "S" },
            { AttributeName: "seq", AttributeType: "N" }
        ],
        ProvisionedThroughput: {
            ReadCapacityUnits: 10,
            WriteCapacityUnits: 10
        }
    };

    const db = new AWS.DynamoDB();
    return Promise.promisify(db.createTable.bind(db))(params)
    /*
    // TODO: createTable is async, check success with describeTable
    .then(() => {
      db.describeTable({TableName: table}, () => {})
    })
    */
    .then(() => {debug("_createTable() created new table '%s'", table)})
    .catch((err, data) => {
      if (err && err.code != 'ResourceInUseException') {
        throw(err);
      } else {
        debug("_createTable() table '%s' already exists", table);
      }
    });
  },

  /*
   * Find all events pertaining to the given aggregateId
   * @returns stream, a node stream of all the events
   */
  find(stream, fromSeq = 1){
    if (typeof(stream) === 'undefined' || stream === null){
      return dynamoStreams.createScanStream((new AWS.DynamoDB), {TableName: this._table});
    }

    debug('find() %s from sequence %d', stream, fromSeq);
    const params = {
      TableName: this._table,
      ExpressionAttributeNames: {
        "#stream": 'stream'
      },
      ExpressionAttributeValues: {
        ":stream": {S: stream},
        ":fromSeq": {N: fromSeq.toString()}
      },
      KeyConditionExpression: "#stream = :stream AND seq >= :fromSeq"
    };
    return dynamoStreams.createQueryStream((new AWS.DynamoDB), params);
  },

  pruneEmptyValues(obj){
    if (Array.isArray(obj)){
      return obj.map((v) => {return this.pruneEmptyValues(v)});
    }
    else if (isDate(obj)){
      return obj.toISOString();
    }
    else if (isObject(obj)){
      obj = Object.assign({}, obj);
      Object.keys(obj).forEach((k) => {obj[k] = this.pruneEmptyValues(obj[k])})
      return obj;
    }

    return obj === '' ? ' ' : obj;
  },

  /*
   * Commit the given events to permanent storage, guaranteed to be atomic, i.e.
   * either all events will be persisted or none
   */
  commit(stream, expectedSeq, events, cb){
    const put = Promise.promisify(this._db.put.bind(this._db));

    return Promise.each(events, (e, i) => {
      //TODO Perhaps the id should be contained in the event
      e = Object.assign({}, e, {stream, seq: expectedSeq + i});
      const params = {
        TableName: this._table,
        Item: this.pruneEmptyValues(e),
        ExpressionAttributeNames: {
          "#stream": 'stream' // Substitute reserved word `stream` with `#stream`
        },
        ConditionExpression: "attribute_not_exists(#stream) AND attribute_not_exists(seq)",
      };

      debug('commit()', e);

      return put(params)
      .catch((err) => {
        if (err.code === 'ConditionalCheckFailedException'){
          err = new Error(`Conflicting sequence number for ${e.type}: ${e.stream}, expected ` +
            `${e.seq}`);
          err.event = e;
          debug(err.message);
        }
        throw err;
      });
    })
    .asCallback(cb);
  },

  reset(journal){
    debug("reset() deleting table '%s'", this._table);
    //TODO: disable on production
    const db = new AWS.DynamoDB();

    let p = null;
    p = Promise.promisify(db.deleteTable.bind(db))({TableName: this._table});
    p = p.then(() => {return this._createTable(this._table)});

    if(journal == undefined)
      return p;

    let seq = 1;
    return p.then(() => {
      return Promise.each(Object.keys(journal), (k) => {
        const currSeq = seq;
        seq += journal[k].length;
        return this.commit(k, currSeq, journal[k]);
      });
    });
    return p;
  },
}

export default DynamoJournal;
