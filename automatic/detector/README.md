# Detector interface · stage 0

Pure TypeScript, no React Native imports. `createDetector(config?)` exports `pushMotion`,
`pushLocation`, `onEvent` (returns unsubscribe), and `reset`. The skeleton deliberately emits no
events, even in demo mode; detection algorithms belong to Lane B milestone 3.

Samples use epoch milliseconds (`t_ms`), acceleration/gravity vectors in m/s², and nullable
GPS speed/accuracy. Unknown speed remains internal; observations require valid nonnegative speed.

From the repository root:

```sh
npm ci --prefix automatic/detector
npm run build --prefix automatic/detector
npm test --prefix automatic/detector
```

The test proves the skeleton does not fabricate evidence; it does not validate braking/bump
algorithms. No recorded rides exist yet.
