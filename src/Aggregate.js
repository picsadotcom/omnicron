import * as R from 'ramda';
import Debug from 'debug';
import assert from 'assert';
import Promise from 'bluebird';
import uuid from 'uuid';

const debug = Debug('omnicron:aggregate');

export const Event = function(options){
  const e = Object.assign({}, options);
  e.uuid = options.uuid || uuid.v4();
  e.ts = options.ts || Date.now();
  Object.freeze(e);
  return e;
}

export const Command = function(options){
  const c = Object.assign({}, options);
  c.uuid = options.uuid || uuid.v4();
  c.ts = options.ts || Date.now();
  Object.freeze(c);
  return c;
}

/*
 * An EventProcessor restores state from a stream and mutates state by applying
 * events
 *
 * replay(stream, journal) -> state
 * apply(state, event) -> state
 */
export const EventProcessor = {
  eventHandlers: undefined,

  /*
   * @param stream
   * @param fromSeq
   * @param state
   * @param journal
   * @return [state, seq] where `state` is the result of replaying all events
   * and `seq` is the sequence number of the last event or `null` if no events
   * were found.
   */
  replay({stream, fromSeq = 0, state, journal} = {}, cb) {
    return new Promise((resolve, reject) => {
      debug('replay(%s, %d, %j)', stream, fromSeq, state);
      let seq = null;
      const eventStream = journal.find(stream, fromSeq);

      // TODO: Would we ever have async eventHandlers?
      eventStream.on('data', (event) => {
        state = this.apply(state, event);
        seq = event.seq;
      });

      eventStream.on('end', () => {
        debug('replay() returning state=%j, sequence=%d', state, seq);
        resolve([state, seq]);
      });

      eventStream.on('error', (err) => {
        debug('replay() returning error=%j, state=%j, seq=%d', error, state, seq);
        reject([err, state, seq])
      });
    }).asCallback(cb, {spread: true});
  },

  _replay({stream, fromSeq = 0, journal} = {}, cb) {
    let events = [];
    return new Promise((resolve, reject) => {
      debug('replay(%s, %d, %j)', stream, fromSeq);
      let seq = null;
      const eventStream = journal.find(stream, fromSeq);

      // TODO: Would we ever have async eventHandlers?
      eventStream.on('data', (event) => {
        events.push(event);
        seq = event.seq;
      });

      eventStream.on('end', () => {
        debug('replay() returning events=%j, sequence=%d', events, seq);
        resolve([events, seq]);
      });

      eventStream.on('error', (err) => {
        debug('replay() returning error=%j, state=%j, seq=%d', error, state, seq);
        reject([err, events, seq])
      });
    }).asCallback(cb, {spread: true});
  },

  apply(state, event){
    debug('apply() calling %s event handler for event: %j', event.type, event)
    return this.eventHandlers && this.eventHandlers[event.type](state, event);
  }
};

/*
 * A command processor executes commands on the given state and returns one or
 * more events.
 *
 * exec(state, command) -> events
 */
export const CommandProcessor = {
  commandHandlers: undefined,
  exec(state, command, cb){
    return new Promise((resolve, reject) => {
      // TODO use schema validation tool?
      if (typeof(command.uuid) === 'undefined' || command.uuid === null)
        reject(new Error('Commands must have an uuid: %j', command));
      if (typeof(command.stream) === 'undefined' || command.stream === null)
        reject(new Error('Commands must belong to a stream: %j', command));

      debug('exec() calling %s command handler for command: %j', command.type, command)
      this.commandHandlers[command.type](state, command, (err, events) => {
        if (err) return reject(err);
        resolve(events);
      });
    }).asCallback(cb);
  }
};

export const CommandEventProcessor = Object.assign({}, CommandProcessor, EventProcessor);

/*
 * An aggregate exposes a single `handle` function which handles incoming
 * commands. For every command, the aggregate uses an EventProcessor to restore
 * the latest state from it's associated stream. It then executes the command
 * using a CommandProcessor which produces events. Newly produced events are
 * commited back to the stream and if successful, updates state.
 *
 * handle(command) -> state
 */
export const Aggregate = {
  initialState: undefined,
  journal: undefined,

  create(commandHandlers, eventHandlers, journal){
    return Object.assign(Object.create(Aggregate), {commandHandlers}, {eventHandlers}, {journal});
  },

  handle(command, cb){
    // TODO add options paramater with options = {replay: true/false} to allow
    // certain commands to be processed without replaying the aggregate's stream
    console.assert(this.journal, 'Aggregate has no Journal');

    const opts = {
      stream: command.stream,
      state: this.initialState,
      apply: this.apply,
      journal: this.journal
    };

    // The special internal command `__replay` returns all historic events
    if (command.type === '__replay'){
      console.log('replaying')
      return this._replay(opts)
      .then(([events, seq]) => {
        console.log('replay returning', events)
        return events;
      });
    }

    /* All other commands cause the aggregate to:
     * (1) replay historic events to restore state
     * (2) execute the given command against the state
     * (3) commit any events triggered by the command
     * (4) return these same triggered events to the caller
     */
    let state, expectedSeq, events = null; // Shared across the promise chain

    return this.replay(opts)
    .then(([_state, seq]) => {
      state = _state; expectedSeq = seq + 1;
      return this.exec(state, command);
    }).then((_events) => {
      events = Array.isArray(_events) ? _events : [_events];
      return this.journal.commit(command.stream, expectedSeq, events);
    }).then(() => {
      return state = events.reduce(this.apply.bind(this), state);
    }).asCallback(cb);
  }
};
Object.setPrototypeOf(Aggregate, CommandEventProcessor);

export default Aggregate;
