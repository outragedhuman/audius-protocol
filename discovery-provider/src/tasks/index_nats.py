import asyncio
import json
import logging
import os

import nats
from nats.errors import TimeoutError
from src.tasks.celery_app import celery
from src.tasks.entity_manager.entity_manager import entity_manager_update
from src.utils import helpers
from web3 import Web3
from web3.datastructures import AttributeDict

logger = logging.getLogger(__name__)
abi_values = helpers.load_abi_values()
web3 = Web3()
em_contract = web3.eth.contract(abi=abi_values["EntityManager"]["abi"])
nats_url = os.getenv("nats_url", "localhost:4222")


async def fetch_writes_from_nats():
    nc = await nats.connect(nats_url)
    js = nc.jetstream()

    # for now we'll just consume from beginning
    osub = await js.subscribe("audius.staging.>", ordered_consumer=True)

    # Fetch and ack messagess from consumer.
    num = 0
    writes = []
    while True:
        try:
            msg = await osub.next_msg()

            body = json.loads(msg.data)
            sender_address = body["senderAddress"]
            encoded_abi = body["encodedABI"]

            params = em_contract.decode_function_input(encoded_abi)[1]
            params["_signer"] = sender_address
            params["transactionHash"] = f"hash{num}"

            params2 = {"args": AttributeDict(params), "transactionHash": f"hash{num}"}
            print(params2)
            writes.append(params2)

        except TimeoutError:
            # normally we'd poll... but for now we'll quit
            # print("Request timed out... sleeping")
            # await asyncio.sleep(3)
            break

    await nc.close()
    return writes


async def async_main():

    write_list = await fetch_writes_from_nats()
    db = update_task.db
    with db.scoped_session() as session:

        # do each message in a batch of 1
        # so we can get per-task error handling
        for write in write_list:
            try:
                entity_manager_update(
                    None,
                    update_task,
                    session,
                    [write],
                    block_number=0,  # todo
                    block_timestamp=1585336422,  # todo
                    block_hash=0,  # todo
                    metadata={},  # todo
                )
            except Exception as err:
                print("no go", err)


@celery.task(name="index_nats", bind=True)
def update_task(self):
    asyncio.run(async_main())
