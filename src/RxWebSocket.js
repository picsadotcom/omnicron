import { Subject, BehaviorSubject, Observable } from '@reactivex/rxjs';

/*
 * Wraps a WebSocket in an RxJs Subject
 */

let RxWebSocket = {
  CONNECTING: WebSocket.CONNECTING,
  OPEN: WebSocket.OPEN,
  CLOSED: WebSocket.CLOSED
};

const selector = (e) => {
  return JSON.parse(e.data);
};

RxWebSocket.create = (url, WebSocketCtor = WebSocket) => {
  let socket = null;
  let rxSocket = null;
  const readyState = new BehaviorSubject(RxWebSocket.CONNECTING);

  const observable = Observable.create((obs) => {
    const onComplete = () => {
      if (socket && socket.close) socket.close();
      socket = null;
    };

    try {
      socket = new WebSocketCtor(url);
    } catch (e) {
      obs.error(e);
      return onComplete;
    }

    socket.onopen = () => readyState.next(RxWebSocket.OPEN);

    socket.onclose = (e) => {
      readyState.next(RxWebSocket.CLOSED);
      if (e.wasClean) {
        obs.complete();
      } else {
        obs.error(e);
      }
    };

    socket.onerror = (e) => obs.error(e);

    socket.onmessage = (e) => obs.next(selector(e));

    return onComplete;
  })
  .share()
  .retryWhen(errors => errors.switchMap(err => {
    readyState.next(RxWebSocket.CONNECTING);
    if (navigator.onLine) {
      // if we have a network connection, try again in 3 seconds
      return Observable.timer(3000);
    } else {
      // if we're offline, so wait for an online event.
      return Observable.fromEvent(window, 'online').take(1);
    }
  }));

  const observer = {
    next: (message) => {
      const data = typeof message === 'string' ? message : JSON.stringify(message);
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(data);
      }
    },
    error: (err) => {
      if (socket) socket.close(3000, err);
      socket = null;
    },
    complete: () => {
      if (socket) socket.close();
      socket = null;
    }
  };

  rxSocket = Subject.create(observer, observable);
  rxSocket.readyState = readyState;
  return rxSocket;
};

export default RxWebSocket;
