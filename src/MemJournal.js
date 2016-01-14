import streamify from 'stream-array';
import Promise from 'bluebird';
import Debug from 'debug'

const debug = Debug('omnicron:memjournal');

let MemJournal = {
  /* Expose private journal for testing*/
  _journal: {},

  init(){ return Promise.resolve(); },
  /*
   * Find all events pertaining to the given aggregateId
   * @returns stream, a node stream of all the events
   */
  find(aggregateId, fromSeq = 1){
    debug('find()', aggregateId, fromSeq);
    let events = (this._journal[aggregateId] || []).filter((e) => {
      return e.seq >= fromSeq;
    });
    return streamify(events);
  },

  /*
   * Commit the given events to permanent storage, guaranteed to be atomic, i.e.
   * either all events will be persisted or none
   */
  commit(aggregateId, expectedSeq, events, cb){
    return new Promise((resolve, reject) => {
      this._journal[aggregateId] = this._journal[aggregateId] || [];
      events.forEach((e, i) => {
        //TODO Perhaps the id should be contained in the event
        e = Object.assign({}, e, {id: aggregateId, seq: expectedSeq + i});
        debug('commit()', e, this._journal[aggregateId].length);
        if (this._journal[aggregateId].length + 1 === e.seq) {
          this._journal[aggregateId] = this._journal[aggregateId].concat(e);
          resolve(events);
        }
        else {
          let err = new Error(`Conflicting sequence number for ${e.type}: ${e.id}, expected ` +
            `${e.seq} found ${this._journal[aggregateId].length + 1}`);
          err.events = events;
          debug(err.message);
          reject(err);
        }
      })
    }).asCallback(cb);
  },

  reset(journal){
    this._journal = {};

    if (journal == undefined)
      return Promise.resolve();

    let seq = 1;
    return Promise.each(Object.keys(journal), (k) => {
      const currSeq = seq;
      seq += journal[k].length;
      return this.commit(k, currSeq, journal[k]);
    });
  },
}

export default MemJournal;
