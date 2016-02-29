export default function Journal() {
  return {
    /*
     * Find all events pertaining to the given aggregateId after `version`
     * @param version, only return events newer than `version`
     * @returns stream, a node stream of all the events
     */
    find(stream, fromSeq){
    },

    /*
     * Commit the given events to permanent storage, guaranteed atomic
     */
    commit(stream, expectedSeq, events, cb){
    }
  };

};
