/**
 * Smol FE Tools for OpenClaw
 * 
 * This file defines the types for the tools exposed to OpenClaw agents.
 */

export interface PlayRadioArgs {
    /**
     * The genre of music to play.
     * @default "random"
     */
    genre?: "lofi" | "ambient" | "breakcore" | "random";
}

export interface SearchArgs {
    /**
     * The tag or genre to search for (e.g., "dnb", "piano", "cyber").
     */
    query: string;
}

export interface GetBalanceArgs {
    /**
     * Wallet address to check. If omitted, checks connected wallet.
     */
    address?: string;
}

export const tools = [
    {
        name: "smol.radio.play",
        description: "Plays music from the Smol Radio.",
        parameters: {
            type: "object",
            properties: {
                genre: {
                    type: "string",
                    enum: ["lofi", "ambient", "breakcore", "random"],
                    description: "The specific genre to play."
                }
            }
        }
    },
    {
        name: "smol.directory.getLatest",
        description: "Fetches the most recently minted Smol (song/image).",
        parameters: {
            type: "object",
            properties: {}
        }
    },
    {
        name: "smol.directory.search",
        description: "Search for a specific Smol by tag or genre.",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "The tag or keyword to search for."
                }
            },
            required: ["query"]
        }
    },
    {
        name: "smol.wallet.getBalance",
        description: "Get the connected wallet's balance.",
        parameters: {
            type: "object",
            properties: {
                address: {
                    type: "string",
                    description: "Wallet address to check."
                }
            }
        }
    }
];
