import './style.css'
import typescriptLogo from './typescript.svg'
import viteLogo from '/vite.svg'
import {DataEvent, EmptyEvent, ErrorEvent, SseClient} from "./sse-client.ts";

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div>
    <a href="https://vitejs.dev" target="_blank">
      <img src="${viteLogo}" class="logo" alt="Vite logo" />
    </a>
    <a href="https://www.typescriptlang.org/" target="_blank">
      <img src="${typescriptLogo}" class="logo vanilla" alt="TypeScript logo" />
    </a>
    <h1>Vite + TypeScript</h1>
    <div class="card">
      <button id="counter" type="button"></button>
    </div>
    <p class="read-the-docs">
      Click on the Vite and TypeScript logos to learn more
    </p>
  </div>
`

const client = new SseClient("http://localhost:3000", {});
client.addEventListener('message', (event: DataEvent): boolean | null => {
    console.log(event);
    return false;
})
client.addEventListener('error', (event: ErrorEvent): boolean | null => {
    console.log(event);
    return false;
})
client.addEventListener('empty', (event: EmptyEvent): boolean | null => {
    // console.log(event);
    return false;
});

setTimeout(() => client.close(), 5000);
console.log(client);