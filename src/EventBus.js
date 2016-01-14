import { Subject } from '@reactivex/rxjs';

// Creates a singleton Subject for all events
const EventBus = new Subject();

export default EventBus;
