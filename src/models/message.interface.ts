// src/models/message.interface.ts
export interface WhatsAppMessage {
  messaging_product: string;
  to: string;
  type: string;
  interactive?: {
    type: string;
    body: {
      text: string;
    };
    action: {
      buttons: {
        type: string;
        reply: {
          id: string;
          title: string;
        };
      }[];
    };
  };
  text?: {
    body: string;
  };
}

export interface IncomingMessage {
  entry: Array<{
    changes: Array<{
      value: {
        messages?: Array<{
          from: string;
          type: string;
          interactive?: {
            type: string;
            button_reply?: {
              id: string;
              title: string;
            };
          };
          text?: {
            body: string;
          };
        }>;
      };
    }>;
  }>;
  object: string;
}