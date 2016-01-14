import test from 'tape';
import Journal from './MemJournal';

const event = {type: 'TestEvent'};

test('MemJournal.commit() errors when referencing a stale aggregate version', (t) => {
  Journal.reset();
  Journal.commit('TestAggregate', 1, [event])
  .then(() => {return Journal.commit('TestAggregate', 1, [event])})
  .then(() => {t.fail('commit() to a stale aggregate version did not fail.')})
  .catch((err) => {
    t.equal(err.message, 'Conflicting sequence number for TestEvent: TestAggregate, expected 1 found 2');
    t.end();
  });
});

test('MemJournal.commit() succeeds for two commits with succeeding aggregate versions', (t) => {
  Journal.reset();
  Journal.commit('TestAggregate', 1, [event])
  .then(() => {return Journal.commit('TestAggregate', 2, [event])})
  .then((events) => {
    t.deepEqual(events, [event]);
    t.end();
  })
  .catch(t.end);
});

test('MemJournal.commit() succeeds for commits containing several events', (t) => {
  Journal.reset();
  Journal.commit('TestAggregate', 1, [event, event, event])
  .then(() => {Journal.commit('TestAggregate', 4, [event])})
  .then(() => {Journal.commit('TestAggregate', 5, [event, event])})
  .then((err) => {
    t.equal(Journal._journal['TestAggregate'].length, 6);
    t.end(err);
  });
});

test("MemJournal.find() streams back all of an aggregate's events", (t) => {
  Journal.reset();
  let count = 0;
  Journal.commit('TestAggregate', 1, [event, event, event])
  .then(() => {
    let stream = Journal.find('TestAggregate', 0);
    stream.on('data', (e) => {count = count+1});
    stream.on('end', () => {
      t.equal(count, 3, 'Stream did not return all commited events');
      t.end();
    });
  })
  .error(t.end);
})
