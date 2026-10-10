import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDetector } from './dist/index.js';
test('stage 0 stub does not fabricate hazard evidence', () => {
  const detector = createDetector({demoMode:true});
  let count = 0;
  const unsubscribe = detector.onEvent(() => count++);
  detector.pushLocation({t_ms:0,lat:33.7531,lon:-84.3853,speed_mps:6,accuracy_m:2});
  detector.pushMotion({t_ms:0,accel:{x:20,y:0,z:20},gravity:{x:0,y:0,z:9.80665}});
  detector.reset(); unsubscribe();
  assert.equal(count,0);
});
