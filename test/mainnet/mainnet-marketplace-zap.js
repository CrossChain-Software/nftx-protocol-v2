const { expect } = require("chai");
const { expectRevert } = require("../../utils/expectRevert");

const { BigNumber } = require("@ethersproject/bignumber");
const { ethers, upgrades } = require("hardhat");


const BASE = BigNumber.from(10).pow(18);
const zeroAddr = "0x0000000000000000000000000000000000000000";
const notZeroAddr = "0x000000000000000000000000000000000000dead";

let primary, alice, bob, kiwi;
let dao, dev;

let nftx;
let zap, stakingZap;
let staking;
let erc721;
let feeDistrib;
let controller;
let provider;
const vaults = [];

describe("LP Zap Test", function () {
  before("Setup", async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_MAINNET_API_KEY}`,
            blockNumber: 13140440,
          },
        },
      ],
    });

    signers = await ethers.getSigners();
    primary = signers[0];
    alice = signers[1];
    bob = signers[2];
    console.log(primary.address);

    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0x08D816526BdC9d077DD685Bd9FA49F58A5Ab8e48"],
    });
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0x40d73df4f99bae688ce3c23a01022224fe16c7b2"],
    });
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0xDEA9196Dcdd2173D6E369c2AcC0faCc83fD9346a"],
    });

    kiwi = await ethers.provider.getSigner(
      "0x08D816526BdC9d077DD685Bd9FA49F58A5Ab8e48"
    );
    dao = await ethers.provider.getSigner(
      "0x40d73df4f99bae688ce3c23a01022224fe16c7b2"
    );
    dev = await ethers.provider.getSigner(
      "0xDEA9196Dcdd2173D6E369c2AcC0faCc83fD9346a"
    );
    vault = await ethers.getContractAt(
      "NFTXVaultUpgradeable",
      "0x114f1388fab456c4ba31b1850b244eedcd024136"
    );
    vaults.push(vault);

    nftx = await ethers.getContractAt(
      "NFTXVaultFactoryUpgradeable",
      "0xBE86f647b167567525cCAAfcd6f881F1Ee558216"
    );
    erc721 = await ethers.getContractAt(
      "CryptoPunksMarket",
      "0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB"
    );
    staking = await ethers.getContractAt(
      "NFTXLPStaking",
      "0x688c3E4658B5367da06fd629E41879beaB538E37"
    );
    feeDistrib = await ethers.getContractAt(
      "NFTXFeeDistributor",
      "0x7AE9D7Ee8489cAD7aFc84111b8b185EE594Ae090"
    );
    controller = await ethers.getContractAt(
      "ProxyController",
      "0x4333d66Ec59762D1626Ec102d7700E64610437Df"
    );

    let Zap = await ethers.getContractFactory("NFTXMarketplaceZap");
    zap = await Zap.deploy(
      "0xBE86f647b167567525cCAAfcd6f881F1Ee558216",
      "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F" /* Sushi Router */
    );
    await zap.deployed();

    let StakingZap = await ethers.getContractFactory("NFTXStakingZap");
    stakingZap = await StakingZap.deploy(
      "0xBE86f647b167567525cCAAfcd6f881F1Ee558216",
      "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F" /* Sushi Router */
    );
    await stakingZap.deployed();

    await nftx.connect(dao).setZapContract(stakingZap.address);
  });

  it("Should upgrade the factory and child", async () => {
    let NewFactory = await ethers.getContractFactory("NFTXVaultFactoryUpgradeable");
    let newFactory = await NewFactory.deploy();
    await newFactory.deployed();
    await controller.connect(dao).upgradeProxyTo(0, newFactory.address);
    let NewVault = await ethers.getContractFactory("NFTXVaultUpgradeable");
    let newVault = await NewVault.deploy();
    await newVault.deployed();
    await nftx.connect(dao).upgradeChildTo(newVault.address);

    await nftx.connect(dao).assignFees();
  });

  it("Should enable fee distribution", async () => {
    await feeDistrib.connect(dao).pauseFeeDistribution(false);
  });

  it("Should exclude the zap from fees", async () => {
    await nftx.connect(dao).setFeeExclusion(stakingZap.address, true);
  })
  
  it("Should set state fields", async () => {
    expect(await zap.nftxFactory()).to.equal(nftx.address);
    expect(await zap.lpStaking()).to.equal(staking.address);
    expect(await zap.sushiRouter()).to.equal(
      "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F"
    );
  });

  it("Should mint some 721", async () => {
    const assetAddress = await vaults[0].assetAddress();
    const coolCats = await ethers.getContractAt("ERC721", assetAddress);
    await coolCats.connect(kiwi).setApprovalForAll(zap.address, true);
    await vaults[0].connect(kiwi).approve(zap.address, BASE.mul(1000))
    await vaults[0].connect(kiwi).mint([2271], [])
  });

  it("Should successfully mint and sell 721", async () => {
    const router = await ethers.getContractAt("IUniswapV2Router01", "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F");
    const pair = await ethers.getContractAt("IUniswapV2Pair", "0x0225e940deecc32a8d7c003cfb7dae22af18460c")
    const {
      reserve0,
      reserve1,
    } = await pair.getReserves();
    
    const amountIn = BASE.mul(2).sub((await vaults[0].mintFee()).mul(2));
    const amountETH = await router.getAmountOut(amountIn, reserve0, reserve1);
    let preBal = await ethers.provider.getBalance(kiwi.getAddress());
    await zap.connect(kiwi).mintAndSell721(31, [7565,2533], amountETH, [vaults[0].address, await router.WETH()], kiwi.getAddress());
    let postBal = await ethers.provider.getBalance(kiwi.getAddress());
    expect(preBal).to.not.equal(postBal);
    expect(postBal).to.be.gt(preBal);

    const assetAddress = await vaults[0].assetAddress();
    const coolCats = await ethers.getContractAt("ERC721", assetAddress);
    expect((await coolCats.ownerOf(7565)).toLowerCase()).to.equal(vaults[0].address)
    expect((await coolCats.ownerOf(2533)).toLowerCase()).to.equal(vaults[0].address)
  })

  it("Should successfully mint and sell 721 using weth", async () => {
    const router = await ethers.getContractAt("IUniswapV2Router01", "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F");
    const pair = await ethers.getContractAt("IUniswapV2Pair", "0x0225e940deecc32a8d7c003cfb7dae22af18460c")
    const {
      reserve0,
      reserve1,
    } = await pair.getReserves();
    const WETH = await zap.WETH();
    const weth = await ethers.getContractAt("IERC20Upgradeable", WETH);
    
    const amountIn = BASE.mul(2).sub((await vaults[0].mintFee()).mul(2));
    const amountETH = await router.getAmountOut(amountIn, reserve0, reserve1);
    let preBal = await weth.balanceOf(kiwi.getAddress());
    await zap.connect(kiwi).mintAndSell721WETH(31, [7984,7412], amountETH, [vaults[0].address, await router.WETH()], kiwi.getAddress());
    let postBal = await weth.balanceOf(kiwi.getAddress());
    let zapBal = await weth.balanceOf(zap.address);
    expect(zapBal).to.equal(0);
    expect(preBal).to.not.equal(postBal);
    expect(postBal).to.be.gt(preBal);

    const assetAddress = await vaults[0].assetAddress();
    const coolCats = await ethers.getContractAt("ERC721", assetAddress);
    const owner = await coolCats.ownerOf(7984);
    expect(owner.toLowerCase()).to.equal(vaults[0].address)
  })
  
  it("Should successfully buy and redeem 721", async () => {
    const router = await ethers.getContractAt("IUniswapV2Router01", "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F");
    const pair = await ethers.getContractAt("IUniswapV2Pair", "0x0225e940deecc32a8d7c003cfb7dae22af18460c")
    const {
      reserve0,
      reserve1,
    } = await pair.getReserves();
    
    const amountOut = BASE.mul(2).add((await vaults[0].targetRedeemFee()).mul(2));
    const amountETH = await router.getAmountIn(amountOut, reserve1, reserve0);
    let preBal = await ethers.provider.getBalance(kiwi.getAddress());
    await zap.connect(kiwi).buyAndRedeem(31, 2, [7565,2533], [await router.WETH(), vaults[0].address], await kiwi.getAddress(), {value: amountETH});
    let postBal = await ethers.provider.getBalance(kiwi.getAddress());

    expect(await ethers.provider.getBalance(zap.address)).to.equal(BigNumber.from(0));
    expect(await vaults[0].balanceOf(zap.address)).to.equal(BigNumber.from(0));
    expect(preBal).to.not.equal(postBal);
    expect(postBal).to.be.lt(preBal.sub(BASE.div(10)));

    const assetAddress = await vaults[0].assetAddress();
    const coolCats = await ethers.getContractAt("ERC721", assetAddress);
    expect(await coolCats.ownerOf(7565)).to.equal(await kiwi.getAddress())
    expect(await coolCats.ownerOf(2533)).to.equal(await kiwi.getAddress())
  })


  it("Should successfully buy and swap 721", async () => {
    await vaults[0].connect(dev).assignDefaultFeatures();
    const assetAddress = await vaults[0].assetAddress();
    const coolCats = await ethers.getContractAt("ERC721", assetAddress);
    expect(await coolCats.ownerOf(2533)).to.equal(await kiwi.getAddress())

    const router = await ethers.getContractAt("IUniswapV2Router01", "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F");
    const pair = await ethers.getContractAt("IUniswapV2Pair", "0x0225e940deecc32a8d7c003cfb7dae22af18460c")
    const {
      reserve0,
      reserve1,
    } = await pair.getReserves();
    
    const amountOut = (await vaults[0].targetRedeemFee()).add(await vaults[0].mintFee());
    const amountETH = await router.getAmountIn(amountOut, reserve1, reserve0);
    let preBal = await ethers.provider.getBalance(kiwi.getAddress());
    await zap.connect(kiwi).buyAndSwap721(31, [2533], [2271], [await router.WETH(), vaults[0].address], await kiwi.getAddress(), {value: amountETH});
    let postBal = await ethers.provider.getBalance(kiwi.getAddress());

    expect(await ethers.provider.getBalance(zap.address)).to.equal(BigNumber.from(0));
    expect(await vaults[0].balanceOf(zap.address)).to.equal(BigNumber.from(0));
    expect(preBal).to.not.equal(postBal);
    expect(postBal).to.be.lt(preBal.sub(BASE.div(10)));

    expect(await coolCats.ownerOf(2271)).to.equal(await kiwi.getAddress())
  })
  
  it("Should successfully buy and redeem 721 using WETH", async () => {
    const router = await ethers.getContractAt("IUniswapV2Router01", "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F");
    const pair = await ethers.getContractAt("IUniswapV2Pair", "0x0225e940deecc32a8d7c003cfb7dae22af18460c")
    const {
      reserve0,
      reserve1,
    } = await pair.getReserves();
    
    const amountOut = BASE.mul(2).add((await vaults[0].targetRedeemFee()).mul(2));
    const amountETH = await router.getAmountIn(amountOut, reserve1, reserve0);

    const WETH = await zap.WETH();
    const weth = await ethers.getContractAt("contracts/solidity/NFTXMarketplaceZap.sol:IWETH", WETH);
    await weth.connect(kiwi).deposit({value: amountETH});
    const weth20 = await ethers.getContractAt("IERC20Upgradeable", WETH);
    await weth20.connect(kiwi).approve(zap.address, BASE.mul(500))

    let preBal = await weth.balanceOf(kiwi.getAddress());
    await zap.connect(kiwi).buyAndRedeemWETH(31, 2, [7984,7412], amountETH, [await router.WETH(), vaults[0].address], kiwi.getAddress());
    let postBal = await weth.balanceOf(kiwi.getAddress());

    expect(await weth.balanceOf(zap.address)).to.equal(BigNumber.from(0));
    expect(await vaults[0].balanceOf(zap.address)).to.equal(BigNumber.from(0));
    expect(preBal).to.not.equal(postBal);
    expect(postBal).to.be.lt(preBal);

    const assetAddress = await vaults[0].assetAddress();
    const coolCats = await ethers.getContractAt("ERC721", assetAddress);
    expect(await coolCats.ownerOf(7984)).to.equal(await kiwi.getAddress())
  })

  let noPool1155NFT;
  let nft1155Id;
  it("Should create a vault for an ERC1155 token", async () => {
    let ERC1155 = await ethers.getContractFactory("ERC1155");
    noPool1155NFT = await ERC1155.deploy("");
    await noPool1155NFT.deployed();
    const response = await nftx.createVault("FAKE", "FAKE", noPool1155NFT.address, true, true);
    const receipt = await response.wait(0);
    nft1155Id = receipt.events
      .find((elem) => elem.event === "NewVault")
      .args[0].toString();
    const vaultAddr = await nftx.vault(nft1155Id);
    await noPool1155NFT.connect(kiwi).publicMintBatch(kiwi.getAddress(), [0, 1, 2, 3], [15, 15, 15, 10]);
    let new1155Vault = await ethers.getContractAt("NFTXVaultUpgradeable", vaultAddr);
    vaults.push(new1155Vault)
  });

  it("Should add liquidity with 1155 using weth with no pool", async () => {
    const amountETH = ethers.utils.parseEther("1.0");
    const WETH = await zap.WETH();
    const weth = await ethers.getContractAt("contracts/solidity/NFTXMarketplaceZap.sol:IWETH", WETH);
    await weth.connect(kiwi).deposit({value: amountETH});
    await noPool1155NFT.connect(kiwi).setApprovalForAll(stakingZap.address, true);
    await vaults[1].connect(kiwi).approve(stakingZap.address, BASE.mul(1000))

    const weth20 = await ethers.getContractAt("IERC20Upgradeable", WETH);
    await weth20.connect(kiwi).approve(stakingZap.address, BASE.mul(500));
    await stakingZap.connect(kiwi).addLiquidity1155(nft1155Id, [0, 1, 2], [5, 5, 5], amountETH, amountETH)
  });

  it("Should successfully mint and sell 1155", async () => {
    const router = await ethers.getContractAt("IUniswapV2Router01", "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F");
    await noPool1155NFT.connect(kiwi).setApprovalForAll(zap.address, true);
    let preBal = await ethers.provider.getBalance(kiwi.getAddress());
    await zap.connect(kiwi).mintAndSell1155(nft1155Id, [3], [4], 1, [vaults[1].address, await router.WETH()], kiwi.getAddress());
    let postBal = await ethers.provider.getBalance(kiwi.getAddress());
    expect(preBal).to.not.equal(postBal);
    expect(postBal).to.be.gt(preBal);

    const bal = await noPool1155NFT.balanceOf(vaults[1].address, 3);
    expect(bal).to.equal(4)
  })

  it("Should successfully swap 1155", async () => {
    const router = await ethers.getContractAt("IUniswapV2Router01", "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F");
    const WETH = await router.WETH();
    const stakingProvider = await ethers.getContractAt("StakingTokenProvider", "0x5fAD0e4cc9925365b9B0bbEc9e0C3536c0B1a5C7");

    const pair = await ethers.getContractAt("IUniswapV2Pair", await stakingProvider.pairForVaultToken(vaults[1].address, WETH))
    const {
      reserve0,
      reserve1,
    } = await pair.getReserves();
    const amountOut = ((await vaults[1].targetRedeemFee()).mul(3)).add((await vaults[1].mintFee()).mul(4)).add(await vaults[1].randomRedeemFee());
    const amountETH = await router.getAmountIn(amountOut, reserve0, reserve1);

    const oldbal0 = await noPool1155NFT.balanceOf(kiwi.getAddress(), 0);

    let preBal = await ethers.provider.getBalance(kiwi.getAddress());
    await zap.connect(kiwi).buyAndSwap1155(nft1155Id, [0, 1], [2, 2], [0, 0, 0], [await router.WETH(), vaults[1].address], kiwi.getAddress(), {value: amountETH});
    let postBal = await ethers.provider.getBalance(kiwi.getAddress());
    expect(preBal).to.not.equal(postBal);
    expect(postBal).to.be.lt(preBal);

    const bal = await noPool1155NFT.balanceOf(vaults[1].address, 3);
    expect(bal).to.equal(4)
    const bal0 = await noPool1155NFT.balanceOf(kiwi.getAddress(), 0);
    expect(bal0).to.equal(oldbal0.add(1))
  })

});
