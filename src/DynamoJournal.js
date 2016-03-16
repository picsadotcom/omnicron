import AWS from 'aws-sdk';
import dynamoStreams from 'dynamo-streams';
import Debug from 'debug';
import Promise from 'bluebird';
import assert from 'assert';

const debug = Debug('omnicron:dynamojournal');

const isDate = (value) => toString.call(value) === '[object Date]';
const isObject = (value) => value !== null && typeof value === 'object';

const DynamoJournal = {
  initThen(p) {
    if (this.initDone.isPending()) {
      debug('Journal not initialised, waiting for init() to complete');
    }
    return this.initDone.then(() => p);
  },

  init({table = 'events', awsConfigPath, awsConfig} = {}){
    debug('init() table: ', table);

    if (!this.initDone.isPending()) return this.initDone;

    // Load configuration
    if (awsConfigPath) {
      AWS.config.loadFromPath(awsConfigPath);
    } else {
      AWS.config.update(awsConfig);
    }

    // Create events table if it doesn't exist
    this._table = table;
    this._db = new AWS.DynamoDB.DocumentClient();

    this._createTable(table)
      .then(() => this._initDoneResolve())
      .error((e) => this._initDoneReject(e));
    return this.initDone;
  },

  _createTable(table){
    var params = {
        TableName: table,
        KeySchema: [
            { AttributeName: 'stream', KeyType: 'HASH'},
            { AttributeName: 'seq', KeyType: 'RANGE' }
        ],
        AttributeDefinitions: [
            { AttributeName: 'stream', AttributeType: 'S' },
            { AttributeName: 'seq', AttributeType: 'N' }
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
    .then(() => debug("_createTable() created new table '%s'", table))
    .catch((err) => {
      if (err && err.code !== 'ResourceInUseException') {
        throw err;
      } else {
        debug("_createTable() table '%s' already exists", table);
      }
    });
  },

  /*
   * Find all events pertaining to the given aggregateId
   * @returns stream, a node stream of all the events
   * TODO: change to rxjs subject and wait for initDone before trying to start
   *    streaming
   */
  find(stream, fromSeq = 1, fromTimestamp){
    debug('find() %s from sequence %d, timestamp %d', stream, fromSeq, fromTimestamp);

    if (typeof stream === 'undefined' || stream === null){
      return dynamoStreams.createScanStream(new AWS.DynamoDB(), {TableName: this._table});
    }

    const [streamType, streamId] = stream.split(':');
    let params;

    assert(typeof fromTimestamp === 'undefined' || streamId === '*', 'Cannot use `fromTimestamp` with non-wildcard streams');

    if (streamId === '*') {
      params = {
        TableName: this._table,
        ExpressionAttributeNames: {
          '#stream': 'stream'
        },
        ExpressionAttributeValues: {
          ':streamType': {S: streamType + ':'}
        }
      };

      if (typeof fromTimestamp !== 'undefined') {
        params.ExpressionAttributeValues[':fromTimestamp'] = {N: fromTimestamp.toString()};
        params.FilterExpression = 'begins_with ( #stream, :streamType ) AND ts >= :fromTimestamp';
      } else if (fromSeq) {
        params.ExpressionAttributeValues[':fromSeq'] = {N: fromSeq.toString()};
        params.FilterExpression = 'begins_with ( #stream, :streamType ) AND seq >= :fromSeq';
      } else {
        params.FilterExpression = 'begins_with ( #stream, :streamType )';
      }

      return dynamoStreams.createScanStream(new AWS.DynamoDB(), params);
    } else {
      params = {
        TableName: this._table,
        ExpressionAttributeNames: {
          '#stream': 'stream'
        },
        ExpressionAttributeValues: {
          ':stream': {S: stream},
          ':fromSeq': {N: fromSeq.toString()}
        },
        KeyConditionExpression: '#stream = :stream AND seq >= :fromSeq'
      };
    }

    return dynamoStreams.createQueryStream(new AWS.DynamoDB(), params);
  },

  pruneEmptyValues(obj){
    if (Array.isArray(obj)) {
      return obj.map((v) => this.pruneEmptyValues(v));
    } else if (isDate(obj)) {
      return obj.toISOString();
    } else if (isObject(obj)) {
      let prunedObj = {};
      Object.keys(obj).forEach((k) => {
        prunedObj[k] = this.pruneEmptyValues(obj[k]);
      });
      return prunedObj;
    }

    return obj === '' ? ' ' : obj;
  },

  /*
   * Commit the given events to permanent storage, guaranteed to be atomic, i.e.
   * either all events will be persisted or none
   */
  commit(stream, expectedSeq, events, cb){
    let put = null;

    const mappedEvents = events.map((e, i) => {
      return Object.assign({}, e, {stream, seq: expectedSeq + i});
    });

    return this.initThen(Promise.each(mappedEvents, (e) => {
      // We have to wait for this._db to be set, so we can only create the `put`
      // promise after initThen. We don't want to re-initialize put on each of the
      // events though
      put = put || Promise.promisify(this._db.put.bind(this._db));

      const params = {
        TableName: this._table,
        Item: this.pruneEmptyValues(e),
        ExpressionAttributeNames: {
          '#stream': 'stream' // Substitute reserved word `stream` with `#stream`
        },
        ConditionExpression: 'attribute_not_exists(#stream) AND attribute_not_exists(seq)'
      };

      debug('commit()', e);

      return put(params).catch((err) => {
        let error = null;
        if (err.code === 'ConditionalCheckFailedException') {
          error = new Error(
            `Conflicting sequence number for ${e.type}: ${e.stream},` +
            ` expected ${e.seq}`
          );
          error.event = e;
          debug(error.message);
        }
        throw error || err;
      });
    }))
    .asCallback(cb);
  },

  reset(journal){
    if (process.env.NODE_ENV === 'production') {
      return debug('reset() is disabled in production');
    }

    const db = new AWS.DynamoDB();

    let p = this.initDone.then(() => {
      debug("reset() deleting table '%s'", this._table);
      return Promise.promisify(db.deleteTable.bind(db))({TableName: this._table});
    })
    .then(() => this._createTable(this._table));

    if (journal === undefined) return p;

    let seq = 1;
    return p.then(() => {
      return Promise.each(Object.keys(journal), (k) => {
        const currSeq = seq;
        seq += journal[k].length;
        return this.commit(k, currSeq, journal[k]);
      });
    });
  }
};

DynamoJournal.initDone = new Promise((resolve, reject) => {
  DynamoJournal._initDoneResolve = resolve;
  DynamoJournal._initDoneReject = reject;
});

export default DynamoJournal;
