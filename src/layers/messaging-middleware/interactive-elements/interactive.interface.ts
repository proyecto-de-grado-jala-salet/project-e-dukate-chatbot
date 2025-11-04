// src/layers/messaging-middleware/interactive-elements/interactive.interface.ts

export interface Button {
  id: string;
  title: string;
}

export interface ListSection {
  title: string;
  rows: ListRow[];
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

export interface InteractiveResponse {
  type: 'button' | 'list';
  selectedId: string;
  userPhone: string;
  timestamp: Date;
}

export interface ButtonPayload {
  messaging_product: 'whatsapp';
  to: string;
  type: 'interactive';
  interactive: {
    type: 'button';
    body: {
      text: string;
    };
    action: {
      buttons: {
        type: 'reply';
        reply: {
          id: string;
          title: string;
        };
      }[];
    };
  };
}

export interface ListPayload {
  messaging_product: 'whatsapp';
  to: string;
  type: 'interactive';
  interactive: {
    type: 'list';
    body: {
      text: string;
    };
    action: {
      button: string;
      sections: {
        title: string;
        rows: {
          id: string;
          title: string;
          description?: string;
        }[];
      }[];
    };
  };
}

export interface LinkPayload {
  messaging_product: 'whatsapp';
  to: string;
  type: 'interactive';
  interactive: {
    type: 'cta_url';
    body: {
      text: string;
    };
    action: {
      name: 'cta_url';
      parameters: {
        display_text: string;
        url: string;
      };
    };
  };
}