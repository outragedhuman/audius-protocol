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
/**
 * 
 * @export
 * @interface ConnectedWallets
 */
export interface ConnectedWallets {
    /**
     * 
     * @type {Array<string>}
     * @memberof ConnectedWallets
     */
    erc_wallets: Array<string>;
    /**
     * 
     * @type {Array<string>}
     * @memberof ConnectedWallets
     */
    spl_wallets: Array<string>;
}

export function ConnectedWalletsFromJSON(json: any): ConnectedWallets {
    return ConnectedWalletsFromJSONTyped(json, false);
}

export function ConnectedWalletsFromJSONTyped(json: any, ignoreDiscriminator: boolean): ConnectedWallets {
    if ((json === undefined) || (json === null)) {
        return json;
    }
    return {
        
        'erc_wallets': json['erc_wallets'],
        'spl_wallets': json['spl_wallets'],
    };
}

export function ConnectedWalletsToJSON(value?: ConnectedWallets | null): any {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    return {
        
        'erc_wallets': value.erc_wallets,
        'spl_wallets': value.spl_wallets,
    };
}

