import test from 'blue-tape';
import Journal from './DynamoJournal';

const event = {type: 'TestEvent'};
const awsConfig = {
  region: 'eu-west-1',
  endpoint: 'http://localhost:8000',
  accessKeyId: 'akid',
  secretAccessKey: 'secret'
};
let initDone = Journal.init({awsConfig});

test('DynamoJournal.commit() errors when referencing a stale aggregate version', (t) => {
  initDone
  .then(() => Journal.reset())
  .then(() => Journal.commit('stream:1', 1, [event]))
  .then(() => Journal.commit('stream:1', 1, [event]))
  .then(() => t.fail('commit() to a stale aggregate version did not fail.'))
  .catch((err) => {
    t.equal(err.message, 'Conflicting sequence number for TestEvent: stream:1, expected 1');
    t.end();
  });
});

test('DynamoJournal.commit() succeeds for two commits with succeeding aggregate versions', (t) => {
  initDone
  .then(() => Journal.reset())
  .then(() => Journal.commit('stream:1', 1, [event]))
  .then(() => Journal.commit('stream:1', 2, [event]))
  .then(() => {
    t.pass();
    t.end();
  })
  .catch(t.end);
});

test('DynamoJournal.commit() succeeds for commits containing several events', (t) => {
  initDone
  .then(() => Journal.reset())
  .then(() => Journal.commit('stream:1', 1, [event, event, event]))
  .then(() => Journal.commit('stream:1', 4, [event]))
  .then(() => Journal.commit('stream:1', 5, [event, event]))
  .then(() => {
    t.pass();
    t.end();
  })
  .catch(t.end);
});

test("DynamoJournal.find() streams back all of a stream's events", (t) => {
  let count = 0;

  initDone
  .then(() => Journal.reset())
  .then(() => Journal.commit('stream:1', 1, [event, event, event]))
  .then(() => {
    let stream = Journal.find('stream:1', 0);
    stream.on('data', () => {count = count + 1;});
    stream.on('end', () => {
      t.equal(count, 3, 'Stream did not return all commited events');
      t.end();
    });
  })
  .error(t.end);
});

test('DynamoJournal.find() streams back all events', (t) => {
  let count = 0;

  initDone
  .then(() => Journal.reset())
  .then(() => Journal.commit('client-profile:1', 1, [event, event, event]))
  .then(() => Journal.commit('email:1', 1, [event]))
  .then(() => Journal.commit('stream:1', 1, [event]))
  .then(() => {
    let stream = Journal.find();
    stream.on('data', () => {count = count + 1;});
    stream.on('end', () => {
      t.equal(count, 5, 'Stream did not return all commited events');
      t.end();
    });
  })
  .error(t.end);
});


test('DynamoJournal.find() streams back all events of a specific type of stream', (t) => {
  let count = 0;

  initDone
  .then(() => Journal.reset())
  .then(() => Journal.commit('client-profile:1', 1, [event, event, event]))
  .then(() => Journal.commit('client-profile:2', 1, [event]))
  .then(() => Journal.commit('email:1', 1, [event]))
  .then(() => {
    let stream = Journal.find('client-profile:*');
    stream.on('data', () => {count = count + 1;});
    stream.on('end', () => {
      t.equal(count, 4, 'Stream did not return all commited events');
      t.end();
    });
  })
  .error(t.end);
});
