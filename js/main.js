import { createEngine } from './engine.js';
import { mountUi } from './ui.js';

mountUi({
  engine: createEngine(),
  modulesEl: document.getElementById('modules'),
  adderEl: document.getElementById('adder'),
});
