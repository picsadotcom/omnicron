import {Observable, Subject} from '@reactivex/rxjs';
import Ws from 'ws';
import Debug from 'debug';
import uuid from 'uuid';
import EventBus from './EventBus.js';

const debug = Debug('omnicron:websocket');

// Create an observer for messages that should be sent over the given socket
// TODO Handle errors?
const socketObserver = (socket, serializer, filter = () => true) => {
  return {
    next(message){
      if (socket.readyState === 1 && filter(message)) {
        socket.send(serializer(message));
      }
    },
    error(err){console.error(err);}
  };
};

// Creates a Client mapper with the given `serializer`/`deserializer`.
// The mapper takes an incoming `connection` and emits a corresponding `client`
// subject representing the remote browser.
const Client = (serializer, deserializer) => {
  return (connection) => {
    connection.uuid = uuid.v4();
    debug(`Connection OPEN: ${connection.upgradeReq.headers.host} / ${connection.uuid}`);

    connection.on('close', () => {
      debug(`Connection CLOSED: ${connection.upgradeReq.headers.host}`);
      const streams = connection.streams || {};
      Object.keys(streams).forEach(s => streams[s].unsubscribe());
      // One day in ES7 we can do:
      //Object.values(connection.streams || {}).forEach(s => s.unsubscribe());
    });

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
    let [subs, rest] = messages.partition(({type}) => type === '__Subscribe');
    let [unsubs, commands] = rest.partition(({type}) => type === '__Unsubscribe');

    // The client Observable produces a stream subject for each subscription
    let clientObservable = Observable.create((obs) => {
      subs.subscribe((subCmd) => {
        debug(`Subscribing ${subCmd.meta.ip} to ${subCmd.stream}`);

        // Produces an Observable that forwards all commands to the stream Subject
        // until a `unsubscribe` command for this stream is received
        let streamObservable = commands
          .filter(({stream}) => stream === subCmd.stream)
          .takeUntil(unsubs.filter(({stream}) => stream === subCmd.stream));

        // Combine Observable (provider) and Observer (consumer) into a subject
        let stream = Subject.create(socketObserver(connection, serializer), streamObservable);
        stream.id = subCmd.stream;
        obs.next(stream);

        connection.streams = connection.streams || {};
        connection.streams[subCmd.stream] = stream;
      });
    });

    // Filter all messages sent to this client, only passing through messages
    // for streams which it had subscribed to.
    const filter = function(msg) {
      // Clients can either subscribe directly or use a wildcard '*' subscription
      const directSub = msg.stream && connection.streams && connection.streams[msg.stream];
      const wildcardSub = Object.keys(connection.streams || {}).find((s) => {
          return s[s.length - 1] === '*' && s.split(':')[0] === msg.stream.split(':')[0];
        });
      const subscribed = directSub || wildcardSub;

      // Since the EventBus broadcasts all messages it receives, we need to filter
      // out messages that came from this client.
      // TODO: This logic probably belongs to the EventBus. It's his responsibility
      // to broadcast a received message without also sending it back to it's source.
      const fromUs = msg.meta && msg.meta.client === connection.uuid;
      return subscribed && !fromUs;
    };

    const clientObserver = socketObserver(connection, serializer, filter);
    let client = Subject.create(clientObserver, clientObservable);
    client.ip = meta.ip;
    return client;
  };
};

// Creates a WebSocket server Observable which emits connections
const ServerObservable = (options) => {
  return Observable.create(obs => {
    let wss = new Ws.Server(options);
    console.info(`WebSocket server listening on port: ${options.port}`);
    wss.on('connection', connection => obs.next(connection));
    return () => wss.close();
  }).share();
};

const Server = {
  options: {},
  serializer: JSON.stringify,
  deserializer: JSON.parse,
  router: [],
  register(streamType, aggregate) {
    // TODO We should do some sanity checks here to make sure an aggregate and it's
    // command handlers are valid. We should probably also execute them in a try catch
    // to prevent exceptions from destroying the whole server process.
    //this.router[streamType] = this.router[streamType] || [];
    //this.router[streamType].push(aggregate);
    // TODO In the future we might want to register more than one aggregate
    // per `streamType`
    this.router[streamType] = aggregate;
  },
  listen() {
    // The Socket Server listens on the given port and emits each incoming connection
    let connections = ServerObservable(this.options);
    // We map incoming connections onto `Client` creating an Observable that emits clients
    let clients = connections.map(Client(this.serializer, this.deserializer));

    // For each new client...
    clients.subscribe((client) => {
      // Broadcast all EventBus events to the client
      EventBus.subscribe(client);

      // Once a client subscribes to a stream...
      client.subscribe((stream) => {
        stream.subscribe((cmd) => {
          // Handle incoming commands
          const streamType = cmd.stream.split(':')[0];
          const aggregate = this.router[streamType] || [];

          return aggregate && aggregate.handle && aggregate.handle(cmd)
          .then(({events}) => {
            // If the command was an non-mutating internal command, only send
            // events to this stream. Otherwise we publish events to the EventBus
            // so that all clients will get updated with the state changes.
            if (cmd.type === '__replay' || cmd.type === '__getState'){
              events.forEach((e) => stream.next(e));
            } else {
              events.forEach((e) => EventBus.next(e));
            }
          });
        });
      });
    });
  }
};

const createServer = (opts) => Object.assign({}, Server, opts);
export {createServer};
