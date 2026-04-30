import './style.css';
import { App } from './galaxy/app';

const host = document.getElementById('app') as HTMLDivElement | null;
if (!host) throw new Error('#app container not found');

new App(host);
