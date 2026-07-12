declare module "ws" {
  export type Data = string | Buffer | ArrayBuffer | Buffer[];
  export default class WebSocket {
    constructor(url: string);
    on(event: "message", cb: (data: Data) => void): void;
    on(event: "open" | "close", cb: () => void): void;
    on(event: "error", cb: (err: Error) => void): void;
    send(data: string): void;
    close(): void;
  }
}
