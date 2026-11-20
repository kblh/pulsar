import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransport } from '../js/transport.js';
import { createSequence } from '../js/sequence.js';

/** The real transport and the real sequence with fake modules, wired the way engine.js wires them. */
function world() {
  const transport = createTransport();
  const mods = new Map();
  const addModule = (id) => {
    const m = { id, running: true, start() { m.running = true; }, stop() { m.running = false; } };
    mods.set(id, m);
    transport.register(m);
    return m;
  };
  const host = {
    ids: () => [...mods.keys()],
    isRunning: (id) => mods.get(id).running,
    setRunning(id, on) {
      const m = mods.get(id);
      if (on && !m.running) m.start();
      else if (!on && m.running) m.stop();
      transport.manual(id);
    },
  };
  const addSequence = (data) => {
    const s = createSequence(data, host);
    transport.register(s);
    return s;
  };
  const sounding = () => [...mods.values()].filter((m) => m.running).map((m) => m.id);
  return { transport, mods, host, addModule, addSequence, sounding };
}
// Parts are edited once the modules exist (members that do not exist yet are dropped), like in the app.
const configure = (seq) => {
  seq.addPart();
  seq.addPart();
  seq.setPart(0, { duration: 10 });
  seq.setPart(1, { duration: 10 });
  seq.toggleMember(0, 1);
  seq.toggleMember(1, 2);
  return seq;
};

test('play all with nothing running enters the part last, whatever order things were registered in', () => {
  for (const order of ['modules first', 'sequence between', 'sequence first']) {
    const w = world();
    let seq;
    if (order === 'modules first') {
      w.addModule(1);
      w.addModule(2);
      seq = w.addSequence({});
    } else if (order === 'sequence between') {
      w.addModule(1);
      seq = w.addSequence({});
      w.addModule(2);
    } else {
      seq = w.addSequence({});
      w.addModule(1);
      w.addModule(2);
    }
    configure(seq);
    for (const m of w.mods.values()) m.stop();
    w.transport.playAll();
    assert.equal(seq.running, true, order);
    assert.deepEqual(w.sounding(), [1], order);
  }
});

test('stop all, skip while paused, play all lands in the skipped-to part with only its members', () => {
  for (const sequenceFirst of [false, true]) {
    const w = world();
    let seq;
    if (sequenceFirst) {
      seq = w.addSequence({});
      w.addModule(1);
      w.addModule(2);
    } else {
      w.addModule(1);
      w.addModule(2);
      seq = w.addSequence({});
    }
    configure(seq);
    seq.start();
    assert.deepEqual(w.sounding(), [1]);
    w.transport.stopAll();
    assert.deepEqual(w.sounding(), []);
    assert.equal(seq.running, false);
    seq.next();
    w.transport.playAll();
    assert.equal(seq.running, true);
    assert.deepEqual(w.sounding(), [2], `sequenceFirst=${sequenceFirst}`);
  }
});

test('pressing play on the sequence while stop all is active brings the part to life, and play all later does not resurrect the wrong module', () => {
  const w = world();
  w.addModule(1);
  w.addModule(2);
  const seq = configure(w.addSequence({}));
  seq.start();
  seq.tick(0);
  seq.tick(5);
  w.transport.stopAll();
  assert.deepEqual(w.sounding(), []);
  // the card's play: start, mark it hand-made, apply the part
  seq.start();
  w.transport.manual(seq.id);
  seq.apply();
  assert.deepEqual(w.sounding(), [1], 'the rest of the part is not silent');
  seq.next();
  assert.deepEqual(w.sounding(), [2]);
  w.transport.playAll();
  assert.deepEqual(w.sounding(), [2], 'module 1 stays out of part 2');
});

test('a controlled module that [stop all] stopped and the entered part does not want is taken out of the transport restart list', () => {
  const w = world();
  w.addModule(1);
  w.addModule(2);
  const seq = configure(w.addSequence({}));
  seq.start();
  w.transport.stopAll();
  assert.equal(w.transport.stoppedByUs(1), true);
  seq.next(); // paused: only the position moves, part 2 does not want module 1
  seq.start(); // enters part 2
  assert.equal(w.transport.stoppedByUs(1), false, 'otherwise [play all] would bring module 1 back into part 2');
  assert.deepEqual(w.sounding(), [2]);
  w.transport.stopAll();
  w.transport.playAll();
  assert.deepEqual(w.sounding(), [2]);
});

test('apply does nothing while the sequence is not running', () => {
  const w = world();
  w.addModule(1);
  w.addModule(2);
  const seq = configure(w.addSequence({}));
  w.mods.get(1).stop();
  seq.apply();
  assert.deepEqual(w.sounding(), [2]);
});

test('resuming after stop all keeps a module the user switched off by hand', () => {
  const w = world();
  w.addModule(1);
  w.addModule(2);
  const seq = w.addSequence({});
  seq.addPart();
  seq.setPart(0, { duration: 20 });
  seq.toggleMember(0, 1);
  seq.toggleMember(0, 2);
  seq.start();
  seq.tick(0);
  seq.tick(4);
  w.mods.get(2).stop();
  w.transport.manual(2);
  w.transport.stopAll();
  w.transport.playAll();
  assert.equal(seq.running, true);
  assert.deepEqual(w.sounding(), [1], 'mid-part resume does not re-apply the membership');
});
