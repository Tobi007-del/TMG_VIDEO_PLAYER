export type Msg<T> = {
    join_ref?: string | null;
    ref?: string | null;
    topic: string;
    event: string;
    payload: T;
};
export default class Serializer {
    HEADER_LENGTH: number;
    META_LENGTH: number;
    USER_BROADCAST_PUSH_META_LENGTH: number;
    KINDS: {
        push: number;
        reply: number;
        broadcast: number;
        userBroadcastPush: number;
        userBroadcast: number;
    };
    BINARY_ENCODING: number;
    JSON_ENCODING: number;
    BROADCAST: string;
    encode(msg: Msg<{
        [key: string]: any;
    } | ArrayBuffer>, callback: (result: ArrayBuffer | string) => any): any;
    private _binaryEncodePush;
    private _binaryEncodeUserBroadcastPush;
    private _encodeBinaryUserBroadcastPush;
    private _encodeJsonUserBroadcastPush;
    decode(rawPayload: ArrayBuffer | string, callback: Function): any;
    private _binaryDecode;
    private _decodePush;
    private _decodeReply;
    private _decodeBroadcast;
    private _decodeUserBroadcast;
    private _isArrayBuffer;
}
//# sourceMappingURL=serializer.d.ts.map