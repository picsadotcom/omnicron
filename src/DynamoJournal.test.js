import test from 'tape';
import Journal from './DynamoJournal';

const event = {type: 'TestEvent'};
let initDone = Journal.init();

test('DynamoJournal.commit() errors when referencing a stale aggregate version', (t) => {
  initDone
  .then(() => {return Journal.reset()})
  .then(() => {return Journal.commit('stream-1', 0, [event])})
  .then(() => {return Journal.commit('stream-1', 0, [event])})
  .then(() => {t.fail('commit() to a stale aggregate version did not fail.')})
  .catch((err) => {
    t.equal(err.message, 'Conflicting sequence number for TestEvent: stream-1, expected 0');
    t.end();
  });
});

test('DynamoJournal.commit() succeeds for two commits with succeeding aggregate versions', (t) => {
  initDone
  .then(() => {return Journal.reset()})
  .then(() => {return Journal.commit('stream-1', 0, [event])})
  .then(() => {return Journal.commit('stream-1', 1, [event])})
  .then(() => {
    t.pass()
    t.end()
  })
  .catch(t.end);
});

test('DynamoJournal.commit() succeeds for commits containing several events', (t) => {
  initDone
  .then(() => {return Journal.reset()})
  .then(() => {return Journal.commit('stream-1', 0, [event, event, event])})
  .then(() => {return Journal.commit('stream-1', 3, [event])})
  .then(() => {return Journal.commit('stream-1', 4, [event, event])})
  .then(() => {
    t.pass();
    t.end();
  })
  .catch(t.end)
});

test("DynamoJournal.find() streams back all of a stream's events", (t) => {
  let count = 0;

  initDone
  .then(() => {return Journal.reset()})
  .then(() => {return Journal.commit('stream-1', 0, [event, event, event])})
  .then(() => {
    let stream = Journal.find('stream-1', 0);
    stream.on('data', (e) => {count = count+1});
    stream.on('end', () => {
      t.equal(count, 3, 'Stream did not return all commited events');
      t.end();
    });
  })
  .error(t.end);
});

test("DynamoJournal.find() streams back all events", (t) => {
  let count = 0;

  initDone
  .then(() => {return Journal.reset()})
  .then(() => {return Journal.commit('stream-1', 0, [event, event, event])})
  .then(() => {return Journal.commit('stream-2', 0, [event])})
  .then(() => {return Journal.commit('stream-3', 0, [event])})
  .then(() => {
    let stream = Journal.find();
    stream.on('data', (e) => {count = count+1});
    stream.on('end', () => {
      t.equal(count, 5, 'Stream did not return all commited events');
      t.end();
    });
  })
  .error(t.end);
});
