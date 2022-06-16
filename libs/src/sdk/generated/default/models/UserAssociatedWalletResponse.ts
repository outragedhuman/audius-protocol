// @ts-nocheck
/* tslint:disable */
/* eslint-disable */
/**
 * API
 * Audius V1 API
 *
 * The version of the OpenAPI document: 1.0
 * 
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { exists, mapValues } from '../runtime';
import {
    EncodedUserId,
    EncodedUserIdFromJSON,
    EncodedUserIdFromJSONTyped,
    EncodedUserIdToJSON,
} from './EncodedUserId';

/**
 * 
 * @export
 * @interface UserAssociatedWalletResponse
 */
export interface UserAssociatedWalletResponse {
    /**
     * 
     * @type {EncodedUserId}
     * @memberof UserAssociatedWalletResponse
     */
    data?: EncodedUserId;
}

export function UserAssociatedWalletResponseFromJSON(json: any): UserAssociatedWalletResponse {
    return UserAssociatedWalletResponseFromJSONTyped(json, false);
}

export function UserAssociatedWalletResponseFromJSONTyped(json: any, ignoreDiscriminator: boolean): UserAssociatedWalletResponse {
    if ((json === undefined) || (json === null)) {
        return json;
    }
    return {
        
        'data': !exists(json, 'data') ? undefined : EncodedUserIdFromJSON(json['data']),
    };
}

export function UserAssociatedWalletResponseToJSON(value?: UserAssociatedWalletResponse | null): any {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    return {
        
        'data': EncodedUserIdToJSON(value.data),
    };
}

