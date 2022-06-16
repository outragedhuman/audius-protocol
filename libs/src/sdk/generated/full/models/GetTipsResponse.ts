// @ts-nocheck
/* tslint:disable */
/* eslint-disable */
/**
 * API
 * No description provided (generated by Openapi Generator https://github.com/openapitools/openapi-generator)
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
    FullTip,
    FullTipFromJSON,
    FullTipFromJSONTyped,
    FullTipToJSON,
} from './FullTip';
import {
    VersionMetadata,
    VersionMetadataFromJSON,
    VersionMetadataFromJSONTyped,
    VersionMetadataToJSON,
} from './VersionMetadata';

/**
 * 
 * @export
 * @interface GetTipsResponse
 */
export interface GetTipsResponse {
    /**
     * 
     * @type {number}
     * @memberof GetTipsResponse
     */
    latest_chain_block: number;
    /**
     * 
     * @type {number}
     * @memberof GetTipsResponse
     */
    latest_indexed_block: number;
    /**
     * 
     * @type {number}
     * @memberof GetTipsResponse
     */
    latest_chain_slot_plays: number;
    /**
     * 
     * @type {number}
     * @memberof GetTipsResponse
     */
    latest_indexed_slot_plays: number;
    /**
     * 
     * @type {string}
     * @memberof GetTipsResponse
     */
    signature: string;
    /**
     * 
     * @type {string}
     * @memberof GetTipsResponse
     */
    timestamp: string;
    /**
     * 
     * @type {VersionMetadata}
     * @memberof GetTipsResponse
     */
    version: VersionMetadata;
    /**
     * 
     * @type {Array<FullTip>}
     * @memberof GetTipsResponse
     */
    data?: Array<FullTip>;
}

export function GetTipsResponseFromJSON(json: any): GetTipsResponse {
    return GetTipsResponseFromJSONTyped(json, false);
}

export function GetTipsResponseFromJSONTyped(json: any, ignoreDiscriminator: boolean): GetTipsResponse {
    if ((json === undefined) || (json === null)) {
        return json;
    }
    return {
        
        'latest_chain_block': json['latest_chain_block'],
        'latest_indexed_block': json['latest_indexed_block'],
        'latest_chain_slot_plays': json['latest_chain_slot_plays'],
        'latest_indexed_slot_plays': json['latest_indexed_slot_plays'],
        'signature': json['signature'],
        'timestamp': json['timestamp'],
        'version': VersionMetadataFromJSON(json['version']),
        'data': !exists(json, 'data') ? undefined : ((json['data'] as Array<any>).map(FullTipFromJSON)),
    };
}

export function GetTipsResponseToJSON(value?: GetTipsResponse | null): any {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    return {
        
        'latest_chain_block': value.latest_chain_block,
        'latest_indexed_block': value.latest_indexed_block,
        'latest_chain_slot_plays': value.latest_chain_slot_plays,
        'latest_indexed_slot_plays': value.latest_indexed_slot_plays,
        'signature': value.signature,
        'timestamp': value.timestamp,
        'version': VersionMetadataToJSON(value.version),
        'data': value.data === undefined ? undefined : ((value.data as Array<any>).map(FullTipToJSON)),
    };
}

