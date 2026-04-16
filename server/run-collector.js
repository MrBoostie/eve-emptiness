#!/usr/bin/env node

const { startScheduler } = require('./collector');

console.log('EVE Emptiness Data Collector');
console.log('=============================');
console.log('Starting standalone collector process...');

startScheduler();

console.log('Collector is running. Press Ctrl+C to stop.');