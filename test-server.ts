import express, {Express, Request, Response} from 'express';
import {EventEmitter} from "node:events";
import cors from 'cors';


const app: Express = express();
const port = process.env.PORT || 3000;

// Register middlewares
app.use(cors());

const eventEmitter = new EventEmitter;
app.get('/', (req: Request, res: Response) => {
    const headers = {
        'Content-Type': 'text/event-stream',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache'
    };
    res.writeHead(200, headers);
    const listener = (event: string) => {
        res.write(event);
    };
    // Subscribe, and then unsubscribe when request has ended.
    eventEmitter.on('event', listener)
    req.socket?.on('end', () => {
        console.log("socket has ended");
        eventEmitter.off('event', listener);
    });
});


setInterval(() => {
    eventEmitter.emit('event', 'data:BLOP\n');
    eventEmitter.emit('event', 'data:BLOP2\n');
    eventEmitter.emit('event', 'id:idtjes\n\n');

    eventEmitter.emit('event', ':HEARTBEAT\n\n');
}, 1000);

app.listen(port, () => {
    console.log(`server started on http://localhost:${port}`)
})