import {Observable, Subject} from '@reactivex/rxjs';
import Ws from 'ws';
import Debug from 'debug';
import uuid from 'uuid';
import EventBus from './EventBus.js';
import Promise from 'bluebird';

const debug = Debug('omnicron:websocket');

// Create an observer for messages that should be sent over the given socket
// TODO Handle errors?
const socketObserver = (socket, serializer, filter = () => true) => {
  return {
    next(message){
      console.log('message: ', message, 'filter', filter(message))
      if(socket.readyState === 1 && filter(message)){
        socket.send(serializer(message));
      }
    },
    error(err){console.error(err)}
  }
};

// Creates a Client mapper with the given `serializer`/`deserializer`.
// The mapper takes an incoming `connection` and emits a corresponding `client`
// subject representing the remote browser.
const Client = (serializer, deserializer) => {
  console.log('creating client', serializer.toString(), deserializer.toString())
  return (connection) => {
    connection.uuid = uuid.v4();
    debug(`Connection OPEN: ${connection.upgradeReq.headers.host} / ${connection.uuid}`);

    connection.on('close', () => {
      debug(`Connection CLOSED: ${connection.upgradeReq.headers.host}`);
      const streams = connection.streams || {};
      Object.keys(streams).forEach(s => streams[s].unsubscribe());
      // One day in ES7 we can do:
      //Object.values(connection.streams || {}).forEach(s => s.unsubscribe());
    })

    // Create an Observable of all of this connection's incoming messages, we make
    // sure we `share` this Observable so that we don't add a new `message`
    // listener for each new subscriber
    let messages = Observable.fromEvent(connection, 'message', deserializer).share();

    // Merge meta information into commands such as IP and browser agent
    const meta = {
      ip: connection.upgradeReq.headers.host,
      agent: connection.upgradeReq.headers['user-agent'],
      client: connection.uuid
    };
    messages = messages.map(cmd => Object.assign({}, cmd, {meta}));

    // Partition all messages into: subscriptions, unsubscriptions and commands
    let [subs, rest] = messages.partition(({type}) => type === '__Subscribe')
    let [unsubs, commands] = rest.partition(({type}) => type === '__Unsubscribe')

    // The client Observable produces a stream subject for each subscription
    let clientObservable = Observable.create((obs) => {
      debug('creating new stream Observable')
      subs.subscribe((subCmd) => {
        debug(`Subscribing ${subCmd.meta.ip} to ${subCmd.stream}`);

        // Produces an Observable that forwards all commands to the stream Subject
        // until a `unsubscribe` command for this stream is received
        let streamObservable = commands
          .filter(({stream}) => stream === subCmd.stream)
          .takeUntil(unsubs.filter(({stream}) => stream === subCmd.stream))

        // Combine Observable (provider) and Observer (consumer) into a subject
        let stream = Subject.create(streamObservable, socketObserver(connection, serializer));
        stream.id = subCmd.stream;
        obs.next(stream);

        connection.streams = connection.streams || {};
        connection.streams[subCmd.stream] = stream;
      });
    });

    // Filter all messages sent to this client only passing through messages
    // for streams which it had subscribed to.
    const filter = function(msg) {
      const subscribed = msg.stream && connection.streams && connection.streams[msg.stream];
      // Since the EventBus broadcasts all messages it receives, we need to filter
      // out messages that came from this client.
      // TODO: This logic probably belongs to the EventBus. It's his responsibility
      // to broadcast a received message without also sending it back to it's source.
      const fromUs = msg.meta && msg.meta.client === connection.uuid;
      return subscribed && !fromUs;
    }

    const clientObserver = socketObserver(connection, serializer, filter);
    let client = Subject.create(clientObservable, clientObserver);
    client.ip = meta.ip;
    return client;
  }
}

// Creates a WebSocket server Observable which emits connections
const ServerObservable = (options) => {
  return Observable.create(obs => {
    let wss = new Ws.Server(options);
    console.info(`WebSocket server listening on port: ${options.port}`);
    wss.on('connection', connection => obs.next(connection));
    return () => wss.close();
  }).share();
};

// Test source to send messages to all clients over the EventBus
const source = Observable.interval(1000).map(() => {
  return {
    stream: 'client-profile:0',
    data: {price: Math.random() * 100},
    ts: Date.now()
  }
});
//source.subscribe(EventBus);

const Server = {
  port: 3001,
  serializer: JSON.stringify,
  deserializer: JSON.parse,
  cmdRouter: [],
  register(aggregate) {
    // TODO When we register an aggregate with the router we have all the information
    // we need to map each command -> commandHandler directly. At the moment we
    // still have the aggregate do the mapping again on the incoming message.
    // Who's responsibility is it, the Aggregate or the Router?
    // TODO We should do some sanity checks here to make sure an aggregate and it's
    // command handlers are valid. We should probably also execute them in a try catch
    // to prevent exceptions from destroying the whole server process.
    Object.keys(aggregate.commandHandlers).forEach((cmdType) => {
      this.cmdRouter[cmdType] = this.cmdRouter[cmdType] || [];
      this.cmdRouter[cmdType].push(aggregate);
    });
    const replayCmd = '__replay';
    this.cmdRouter[replayCmd] = this.cmdRouter[replayCmd] || [];
    this.cmdRouter[replayCmd].push(aggregate);
  },
  route(cmd) {
    const aggregates = this.cmdRouter[cmd.type] || [];
    // TODO This is sync psuedo code, convert to real working code
    aggregates[0].handle(cmd).then((events) => {
      // Publish all events to the event bus
      events.forEach((e) => EventBus.next(e));
    })
    Promise.all(aggregates.map((a) => a.handle(cmd))).then((events) => {
      console.log(events);
      // Publish all events to the event bus
      events.forEach((e) => EventBus.next(e));
    });
  },
  listen() {
    // The Socket Server listens on the given port and emits each incoming connection
    let connections = ServerObservable({port: this.port});
    // We map incoming connections onto `Client` creating a Observable that emits clients
    let clients = connections.map(Client(this.serializer, this.deserializer));

    // For each new client...
    clients.subscribe((client) => {

      // Broadcast all EventBus events to the client
      EventBus.subscribe(client);

      // Once a client subscribes to a stream...
      client.subscribe((stream) => {
        console.log('got subscription to', stream.id);
        // Send all incoming commands to the router which routes these to
        // registered aggregates
        stream.subscribe((cmd) => {this.route(cmd)});
      })
    });
  }
};

const createServer = (opts) => {return Object.assign({}, Server, opts)};
export {createServer};