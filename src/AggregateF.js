/*

Experiment...

import * as R from 'ramda';
import Debug from 'debug';
import assert from 'assert';
const debug = Debug('omnicron:aggregate');

import Journal from './MemJournal';
import {LoanPaymentReceived, LoanCreated} from './events';
import {IssueLoan, RecordLoanRepayment} from './commands';

const inspect = (strings, ...subs) => {
  subs.reduce((s, v, i) => {s + util.inspect(v) + strings[i + 1]}, strings[0]);
}

const Aggregate = {
  makeHandler({initialState, eventHandlers, commandHandlers}, journal){
    debug('makeHandler(%j, %j, %j, %j)', initialState, eventHandlers, commandHandlers, journal);
    const exec = Aggregate._exec(commandHandlers);
    const apply = Aggregate._apply(eventHandlers);
    return (command, cb) => {
      debug('handler(%j)', command);
      Aggregate._replay({id: command.id, state: initialState, apply, journal}, (err, state, version) => {
        exec(state, command, (err, events) => {
          events = Array.isArray(events) ? events : [events];
          journal.commit(command.id, version, events, (err) => {
            state = events.reduce(apply, state);
            cb(err, state);
          });
        });
      });
    }
  },

  _replay({id, version = 0, state, apply, journal} = {}, cb) {
    debug('replay(%s, %d, %j)', id, version, state);
    const stream = journal.find(id, version);

    // TODO: Would we ever have async eventHandlers?
    stream.on('data', (event) => {
      state = apply(state, event);
      version = event.version;
    });

    stream.on('end', () => {
      debug('replay() returning state=%j, version=%d', state, version);
      cb(null, state, version);
    });

    stream.on('error', (err) => {
      debug('replay() returning error=%j, state=%j, version=%d', error, state, version);
      cb(err, state, version)}
    );
  },

  _apply(eventHandlers){
    return (state, event) => {
      debug('_apply() calling %s event handler for event: %j', event.type, event)
      return eventHandlers[event.type](state, event);
    }
  },

  _exec(commandHandlers){
    return (state, command, cb) => {
      debug('_exec() calling %s command handler for command: %j', command.type, command)
      commandHandlers[command.type](state, command, cb);
    }
  }
}

// -----------------------------------------------------------------------

const LoanAggregate = {
  initialState: {},
  eventHandlers: {
    LoanCreated(_, e){
      const s = {
        amount: e.amount,
        balance: e.amount,
        interest: e.interest,
        period: e.period
      };
      console.log(s);
      return s;
    },

    LoanPaymentReceived(state, e){
      return R.assoc('balance', state.balance - e.amount, state);
    }
  },
  commandHandlers: {
      IssueLoan(state, cmd, cb){
        // TODO Validate command
        // TODO Apply business rules to state
        cb(null, new LoanCreated(cmd.id, cmd.amount, cmd.interest, cmd.period));
      },

      RecordLoanRepayment(state, cmd, cb) {
        // TODO Validate command
        // TODO Apply business rules to state
        // if state.balance < cmd.amount cb(err) ?
        cb(null, new LoanPaymentReceived(cmd.id, cmd.amount, cmd.date));
      }
  }
};

const loanCommandHandler = Aggregate.makeHandler(LoanAggregate, Journal);

// TODO this is very ugly, can we use streams or promises to make it easier to
// give commands to an Aggregate?
loanCommandHandler(new IssueLoan('8807185049087', 1500, 20, 12), () => {
  loanCommandHandler(new RecordLoanRepayment('8807185049087', 100, new Date('2015/06/30')), () => {
    loanCommandHandler(new RecordLoanRepayment('8807185049087', 100, new Date('2015/06/30')), () => {
      loanCommandHandler(new RecordLoanRepayment('8807185049087', 100, new Date('2015/06/30')), (err, state) => {
        console.log(state);
        assert(state.balance === 1200);
        assert(Journal._journal['8807185049087'].length === 4);
      });
    });
  });
});
*/
