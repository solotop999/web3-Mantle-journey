import Web3 from 'web3';
import { BigNumber } from 'bignumber.js'
import {BaseChain, ChainId, TokenInfoFormatted, initialChainTable} from 'iziswap-sdk/lib/base/types'
import { amount2Decimal, fetchToken, getErc20TokenContract } from 'iziswap-sdk/lib/base/token/token';
import { SwapChainWithExactInputParams } from 'iziswap-sdk/lib/swap/types';
import { QuoterSwapChainWithExactInputParams } from 'iziswap-sdk/lib/quoter/types';
import { getSwapChainWithExactInputCall, getSwapContract } from 'iziswap-sdk/lib/swap/funcs';
import { getQuoterContract, quoterSwapChainWithExactInput } from 'iziswap-sdk/lib/quoter/funcs';
import * as fs from 'fs';

const fileName = 'my_wallets.txt';

function parseKey(fileName: string){
    const listKeys: string[] = [];
    try {
        const fileContent = fs.readFileSync(fileName, 'utf-8');
        const lines = fileContent.split('\n');
      
        function parseHexToString(hexString: string): string {
          return hexString.trim(); // Remove leading/trailing whitespace
        }
        for (const line of lines) {
          const trimmedLine = line.trim(); // Remove leading/trailing whitespace
          if (trimmedLine.length > 0) {
            const hexString = parseHexToString(trimmedLine);
            listKeys.push(hexString);
          }
        }
      
      } catch (error) {
        console.error(`Something Wrong when parse key file: ${error}`);
      }
    
      return  listKeys
      
}


const PRIV_KEYS = parseKey(fileName)

if (PRIV_KEYS.length == 0 ) {
    console.log(PRIV_KEYS, " => my_wallets.txt not defined. Exiting the script.\n");
    process.exit(0); // Exit with an error code
  }

const quoterAddress = '0x032b241De86a8660f1Ae0691a4760B426EA246d7' // izumi mantle Quoter address. https://developer.izumi.finance/iZiSwap/deployed_contracts/mainnet
const swapAddress = '0x25C030116Feb2E7BbA054b9de0915E5F51b03e31' // izumi swap contract
const AMOUNT = 0.0001 // MNT
const NUMBER_LOOP = 100
const WMNT_Address: string = '0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8' //WMNT
const LIST_TOKEN_B_ADDRESS = [
    '0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE', // USDT
    '0xdEAddEaDdeadDEadDEADDEAddEADDEAddead1111', // WETH
    '0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9', //USDC
    '0x60D01EC2D5E98Ac51C8B4cF84DfCCE98D527c747', //IZI
    '0x0A3BB08b3a15A19b4De82F8AcFc862606FB69A2D', //iUSD
]


const CHAIN:BaseChain = initialChainTable[ChainId.Mantle]
const rpc = 'https://mantle.public-rpc.com'
const web3 = new Web3(new Web3.providers.HttpProvider(rpc))

const FEE = 500 // pool fee.. 500 means 0.05%
const IZUMI_QUOTER_CONTRACT = getQuoterContract(quoterAddress, web3)
const IZUMI_SWAP_CONTRACT = getSwapContract(swapAddress, web3)
const MNT_CONTRACT = getErc20TokenContract('0xdeaddeaddeaddeaddeaddeaddeaddeaddead0000', web3)


async function prepare_izumi_swap(tokenBAddress: string ){
        let fee = FEE
        if(tokenBAddress === '0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9' || tokenBAddress === '0x0A3BB08b3a15A19b4De82F8AcFc862606FB69A2D' ){
            fee = 3000
        }
        
        const tokenA = await fetchToken(WMNT_Address, CHAIN, web3)
        const tokenB = await fetchToken(tokenBAddress, CHAIN, web3)
        
        const amountA = new BigNumber(AMOUNT).times(10 ** tokenA.decimal)

        const params = {
            tokenChain: [tokenA, tokenB],
            feeChain: [fee],
            inputAmount: amountA.toFixed(0)
        } as QuoterSwapChainWithExactInputParams

        return {tokenA, tokenB, params}
}

async function izumi_swap(count: number, priv_key: string, tokenA: TokenInfoFormatted, tokenB: TokenInfoFormatted, params:QuoterSwapChainWithExactInputParams) {
    const account =  web3.eth.accounts.privateKeyToAccount(priv_key)

    const myBalance = await MNT_CONTRACT.methods.balanceOf(account.address).call()
    if ((Number(myBalance) / Math.pow(10, 18)) <= 0.5) {
        console.log(`\n${account.address} => HET TIEN ROI...\n`)
        return false
    }
    const {outputAmount} = await quoterSwapChainWithExactInput(IZUMI_QUOTER_CONTRACT, params)
    const amountB = outputAmount
    const amountBDecimal = amount2Decimal(new BigNumber(amountB), tokenB)
    

    // start swap
    const swapParams = {
        ...params,
        // slippery is 1%
        minOutputAmount: new BigNumber(amountB).times(0.99).toFixed(0)
    } as SwapChainWithExactInputParams
    
    const gasPrice = '50000000'

    const {swapCalling, options} = getSwapChainWithExactInputCall(
        IZUMI_SWAP_CONTRACT, 
        account.address, 
        CHAIN, 
        swapParams, 
        gasPrice
    )

    const gasLimit = await swapCalling.estimateGas(options)

    const signedTx = await account.signTransaction(
        {
            ...options,
            to: swapAddress,
            data: swapCalling.encodeABI(),
            gas: new BigNumber(gasLimit * 1.1).toFixed(0, 2),
        }
    )
    if(!signedTx.rawTransaction) {return}

    const tx = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    console.log(`${count}.
    - Address: ${truncateEthereumAddress(account.address)}
    - My balance: ${(Number(myBalance) / Math.pow(10, 18)).toFixed(3)}
    - SWAP:  ${AMOUNT} (${tokenA.symbol})   TO:   ${amountBDecimal} (${tokenB.symbol})
    - Transaction: https://explorer.mantle.xyz/tx/${tx.transactionHash}
    `)

    return true
}

function delay(ms: number) {
    return new Promise( resolve => setTimeout(resolve, ms) );
}

function truncateEthereumAddress(address: string): string {
    if (address.length < 42) {
      throw new Error("Invalid Ethereum address");
    }
    const truncatedAddress = `${address.substring(0, 5)}...${address.slice(-5)}`;
    return truncatedAddress;
  }

async function main() {
    const promises = PRIV_KEYS.map(async (priv_key, index) => {
        const tokenBAddress = LIST_TOKEN_B_ADDRESS[index % LIST_TOKEN_B_ADDRESS.length]; // Assign tokenB based on index
        const { tokenA, tokenB, params } = await prepare_izumi_swap(tokenBAddress);
        for (let _count = 0; _count < NUMBER_LOOP; _count++) {
            const isSwapOk = await izumi_swap(_count, priv_key, tokenA, tokenB, params);
            if(!isSwapOk){ break }
            await delay(Math.floor(Math.random() * (20000 - 10000 + 1)) + 10000);
        }
    });

    await Promise.all(promises);
}


main().then(()=>process.exit(0))
.catch((error) => {
    console.error(error);
    process.exit(1);
})


