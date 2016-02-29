import test from 'blue-tape';
import sinon from 'sinon';
import {Event, Command, EventProcessor, CommandProcessor, Aggregate} from './Aggregate';
import Journal from './DynamoJournal';

const awsConfig = {
  region: 'eu-west-1',
  endpoint: 'http://localhost:8000',
  accessKeyId: 'akid',
  secretAccessKey: 'secret'
};
let initDone = Journal.init({awsConfig});

test("EventProcessor.apply() calls each event's handler", (t) => {
  const events = [Event({type: 'Pinged'}), Event({type: 'Ponged'})];
  const sut = {eventHandlers: {
    Pinged: sinon.stub().returns({}),
    Ponged: sinon.stub().returns({})
  }};
  Object.setPrototypeOf(sut, EventProcessor);
  sut.apply({}, events[0]);
  sut.apply({}, events[1]);
  t.assert(sut.eventHandlers.Pinged.calledOnce, "Didn't call the Pinged event handler");
  t.assert(sut.eventHandlers.Pinged.calledOnce, "Didn't call the Ponged event handler");
  t.end();
});

test.skip('EventProcessor.apply() throws an exception for an undefined event handler', (t) => {
  const event = {type: 'Pinged'};
  const sut = Object.create(EventProcessor, {eventHandlers: {}});
  t.throws(sut.apply({}, event), 'Unhandled event did not throw an exception');
  t.end();
});

test('EventProcessor.apply() mutates the aggregate state for 0, 1 or many events', (t) => {
  const event = {type: 'Pinged'};
  const sut = {eventHandlers: {
    Pinged: () => {return {status: 'pinged'};}
  }};
  Object.setPrototypeOf(sut, EventProcessor);
  let state = sut.apply({}, event);
  t.deepEqual(state, {status: 'pinged'}, 'Applying the event did not mutate the state');
  t.end();
});

test("EventProcessor.replay() restores state from it's journal", (t) => {
  const events = (new Array(10)).fill(1).map((e, i) => {
    return {stream: 'ticker1', type: 'Ticked', seq: i + 1};
  });
  const sut = {
    eventHandlers: {Ticked: (state) => {return {ticks: state.ticks + 1};}}
  };
  Object.setPrototypeOf(sut, EventProcessor);
  return initDone
  .then(() => Journal.reset({ticker1: events}))
  .then(() => sut.replay({stream: 'ticker1', initialState: {ticks: 0}, journal: Journal}))
  .then(([state, seq]) => {
    t.deepEqual(state, {ticks: 10});
    t.equal(seq, 10);
  });
});

test('CommandProcessor.exec() produces events from command handlers', (t) => {
  const sut = {
    commandHandlers: {Tick: (state, cmd, cb) => {
      cb(null, {stream: 'ticker1', type: 'Ticked', data: cmd.data});
    }}
  };
  Object.setPrototypeOf(sut, CommandProcessor);
  const command = Command({stream: 'ticker1', type: 'Tick', data: 'tick data'});
  return sut.exec({}, command).then((events) => {
    t.deepEqual(events, {stream: 'ticker1', type: 'Ticked', data: 'tick data'});
  });
});

test('Aggregate.handle() takes commands and produces the correct state from the resulting events', (t) => {
  const sut = {
    initialState: {ticks: 0},
    journal: Journal,
    commandHandlers: {
      Tick: (state, cmd, cb) => {
        cb(null, {stream: cmd.stream, type: 'Ticked'});
      }
    },
    eventHandlers: {
      Ticked: (state) => {return {ticks: state.ticks + 1};}
    }
  };
  Object.setPrototypeOf(sut, Aggregate);
  const genCommand = () => Command({stream: 'ticker1', type: 'Tick'});
  return initDone.then(Journal.reset.bind(Journal))
  .then(() => sut.handle(genCommand()))
  .then(() => sut.handle(genCommand()))
  .then(() => sut.handle(genCommand()))
  .then(({state}) => t.deepEqual(state, {ticks: 3}));
});
