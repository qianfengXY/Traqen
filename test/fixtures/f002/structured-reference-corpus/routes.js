import express from 'express';
import { lookup as fetch } from './service.js';
const app = express();
function handle(){ fetch(); }
function shadow(fetch){ fetch(); }
app.get('/records/:key', handle);
