import 'fake-indexeddb/auto';
import { worksStoreContract } from './contract';
import { createIdbStore } from '../../src/lib/works/idbStore';

let n = 0;
worksStoreContract('IndexedDB', async () => createIdbStore(`works-test-${n++}`));
