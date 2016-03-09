import { Subject, Observable} from '@reactivex/rxjs';
import RxWebSocket from './RxWebSocket';

const StreamSubject = {
  _subscriptions: [],
  create(rxSocket, streamId, token){
    if (this._subscriptions[streamId]){
      return this._subscriptions[streamId];
    }

    const queue = [];

    let observable = Observable.create((obs) => {
      // When someone subscribes to this observable... subscribe to the socket,
      // passing through messages from the server which belong to this stream
      rxSocket.filter((e) => {
          if (streamId[streamId.length - 1] === '*') {
            return e.stream.split(':')[0] === streamId.split(':')[0];
          } else {
            return e.stream === streamId;
          }
      })
      .filter((e) => {
        if (e.type === '__UnauthorizedError') {
          setTimeout(() => obs.error(e), 0);
          return false;
        }
        return true;
      })
      .subscribe(obs);

      // Send a subscription message when the underlying socket opens (and if it
      // disconnects, each subsequent time it opens again).
      rxSocket.readyState.filter(s => s === RxWebSocket.OPEN)
      .subscribe(() => {
        // Now send a message over the socket to tell the server we want to
        // subscribe to a particular stream of data
        rxSocket.next({stream: streamId, token, type: '__Subscribe' });
        // Send all buffered messages
        while (queue.length > 0 && rxSocket.readyState.getValue() === RxWebSocket.OPEN) {
          rxSocket.next(queue.shift());
        }
      });

      // return an unsubscription function that, when you unsubscribe...
      return () => {
        // ... sends a message to the server to tell it to stop sending data for
        // this stream.
        rxSocket.next({stream: streamId, type: '__Unsubscribe' });
        // ... and then unsubscribe from the socket, if this is the last thing
        // subscribed to the socket, the socket will close!
        rxSocket.unsubscribe();
        // ... and removes the stream from the list of open subscriptions
        delete this._subscriptions[streamId];
      };
    })
    // share it so that we don't call `create` and re-subscribe to the server
    // for each new subscription to this subject
    .share()
    //.replay(1000) // TODO: Replay historic events?
    // if this fails, let's retry. The retryWhen operator
    // gives us a stream of errors that we can transform
    // into an observable that notifies when we should retry the source
    .retryWhen(errors => errors.switchMap(err => {
      if (err.type === '__UnauthorizedError') {
        throw err;
      }

      if (navigator.onLine) {
        // if we have a network connection, try again in 3 seconds
        return Observable.timer(3000);
      } else {
        // if we're offline, wait for an online event.
        return Observable.fromEvent(window, 'online').take(1);
      }
    }));

    const observer = {
      next: (data) => {
        if (rxSocket.readyState.getValue() === RxWebSocket.OPEN) {
          rxSocket.next(data);
        } else {
          queue.push(data);
        }
      },
      error: (e) => console.log('err!!', e),
      complete: () => {}
    };

    this._subscriptions[streamId] = Subject.create(observer, observable);
    return this._subscriptions[streamId];
  }
};

export default StreamSubject;
