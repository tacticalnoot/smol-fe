/**
 * Shared room registry and access control for VIP chat.
 * Single source of truth for valid rooms and access rules.
 */

export type ChatRoom = {
    id: string;
    name: string;
    description: string;
    disabled?: boolean;
    /** Access level: 'public' = any authenticated user, 'gated' = requires eligibility check */
    access?: 'public' | 'gated';
};

export const ROOMS: ChatRoom[] = [
    { id: 'lumenauts', name: 'Lumenauts', description: 'Early adopters only.', access: 'gated' },
    { id: 'builders', name: 'Builders', description: 'Funded accounts.', access: 'gated' },
    { id: 'general', name: 'General', description: 'Everyone welcome.', access: 'public' },
    { id: 'contact', name: 'Your chat here', description: 'Contact admin.', disabled: true },
];

/** Lookup a valid, enabled room by ID. Returns undefined if not found or disabled. */
export function getValidRoom(roomId: string): ChatRoom | undefined {
    const room = ROOMS.find((r) => r.id === roomId);
    if (!room || room.disabled) return undefined;
    return room;
}

/**
 * Quick check: is this room accessible to the given address?
 * For 'public' rooms, always true if authenticated.
 * For 'gated' rooms, default to true for 'builders' (any funded account),
 * and false for 'lumenauts' (requires separate eligibility check).
 * This is a server-side guard - the full Horizon eligibility check
 * should happen during session creation or a dedicated refresh endpoint.
 */
export function isRoomAccessible(roomId: string, _address: string): boolean {
    const room = getValidRoom(roomId);
    if (!room) return false;
    if (room.access === 'public') return true;
    // Gated rooms: general and builders are accessible to authenticated users.
    // Lumenauts requires a cached eligibility bit (not yet implemented - deny by default).
    if (roomId === 'general' || roomId === 'builders') return true;
    // lumenauts and any future gated rooms: deny unless eligibility is cached
    return false;
}
