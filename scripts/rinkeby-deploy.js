const { BigNumber } = require("@ethersproject/bignumber");
const { ethers, upgrades } = require("hardhat");

const treasuryAddr = "0x40d73df4f99bae688ce3c23a01022224fe16c7b2";

const daoAddress = treasuryAddr;

const teamAddresses = [
  "0x701f373Df763308D96d8537822e8f9B2bAe4E847", // gaus1
  "0x4586554a30148B8F4F3AB17E57C430eE193698Ec", // gaus2
  "0x08D816526BdC9d077DD685Bd9FA49F58A5Ab8e48", // kiwi
  "0x3FCe5449C7449983e263227c5AAEACB4A80B87C9", // quag
  "0x4eAc46c2472b32dc7158110825A7443D35a90168", // javery
  "0x45d28aA363fF215B4c6b6a212DC610f004272bb5", // chop
];

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying account:", await deployer.getAddress());
  console.log(
    "Deploying account balance:",
    (await deployer.getBalance()).toString(),
    "\n"
  );

  const StakingProvider = await ethers.getContractFactory(
    "StakingTokenProvider"
  );
  const provider = await upgrades.deployProxy(
    StakingProvider,
    [
      "0xc35DADB65012eC5796536bD9864eD8773aBc74C4" /*Sushiswap*/,
      "0xc778417e063141139fce010982780140aa0cd5ab" /*WETH*/,
      "x",
    ],
    {
      initializer: "__StakingTokenProvider_init",
    }
  );
  await provider.deployed();
  console.log("StakingTokenProvider:", provider.address);

  const Staking = await ethers.getContractFactory("NFTXLPStaking");
  staking = await upgrades.deployProxy(Staking, [provider.address], {
    initializer: "__NFTXLPStaking__init",
  });
  await staking.deployed();
  console.log("Staking:", staking.address);

  const Vault = await ethers.getContractFactory("NFTXVaultUpgradeable");
  const vault = await Vault.deploy();
  await vault.deployed();
  console.log("Vault template:", vault.address);

  const FeeDistributor = await ethers.getContractFactory("NFTXFeeDistributor");
  const feeDistrib = await upgrades.deployProxy(
    FeeDistributor,
    [staking.address, treasuryAddr],
    {
      initializer: "__FeeDistributor__init__",
    }
  );
  await feeDistrib.deployed();
  console.log("FeeDistributor:", feeDistrib.address);

  const Nftx = await ethers.getContractFactory("NFTXVaultFactoryUpgradeable");
  nftx = await upgrades.deployProxy(Nftx, [vault.address, feeDistrib.address], {
    initializer: "__NFTXVaultFactory_init",
  });
  await nftx.deployed();
  console.log("VaultFactory:", nftx.address);

  await feeDistrib.setNFTXVaultFactory(nftx.address);
  await staking.setNFTXVaultFactory(nftx.address);

  const Elig = await ethers.getContractFactory("NFTXEligibilityManager");
  const eligManager = await upgrades.deployProxy(Elig, [], {
    initializer: "__NFTXEligibilityManager_init",
  });
  await eligManager.deployed();

  await nftx.setEligibilityManager(eligManager.address);
  console.log("EligibilityManager:", eligManager.address);

  const ListElig = await ethers.getContractFactory("NFTXListEligibility");
  const listElig = await ListElig.deploy();
  await listElig.deployed();
  await eligManager.addModule(listElig.address);

  const RangeElig = await ethers.getContractFactory("NFTXRangeEligibility");
  const rangeElig = await RangeElig.deploy();
  await rangeElig.deployed();
  await eligManager.addModule(rangeElig.address);

  const Gen0Elig = await ethers.getContractFactory("NFTXGen0KittyEligibility");
  const gen0Elig = await Gen0Elig.deploy();
  await gen0Elig.deployed();
  await eligManager.addModule(gen0Elig.address);

  const Zap = await ethers.getContractFactory("NFTXStakingZap");
  const zap = await Zap.deploy(nftx.address, "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506");
  await zap.deployed();
  await zap.setLockTime(600); // 10 minutes.

  await nftx.setZapContract(zap.address);
  await nftx.setFeeExclusion(zap.address, true);  

  const MarketZap = await ethers.getContractFactory("NFTXMarketplaceZap");
  const marketZap = await MarketZap.deploy(nftx.address, "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506");
  await marketZap.deployed();

  console.log("Staking Zap:", zap.address);
  console.log("Marketplace Zap:", marketZap.address);
  
  const ProxyController = await ethers.getContractFactory("ProxyController");

  const proxyController = await ProxyController.deploy(
    nftx.address,
    eligManager.address,
    provider.address,
    staking.address,
    feeDistrib.address
  );
  await proxyController.deployed();
  console.log("ProxyController address:", proxyController.address);

  console.log("\nUpdating proxy admins...");

  await upgrades.admin.changeProxyAdmin(
    nftx.address, 
    proxyController.address
  );
  await upgrades.admin.changeProxyAdmin(
    eligManager.address,
    proxyController.address
  );
  await upgrades.admin.changeProxyAdmin(
    provider.address,
    proxyController.address
  );
  await upgrades.admin.changeProxyAdmin(
    staking.address,
    proxyController.address
  );
  await upgrades.admin.changeProxyAdmin(
    feeDistrib.address,
    proxyController.address
  );

  console.log("Fetching implementation addresses...");

  await proxyController.fetchImplAddress(0, {
    gasLimit: "150000",
  });
  await proxyController.fetchImplAddress(1, {
    gasLimit: "150000",
  });
  await proxyController.fetchImplAddress(2, {
    gasLimit: "150000",
  });
  await proxyController.fetchImplAddress(3, {
    gasLimit: "150000",
  });
  await proxyController.fetchImplAddress(4, {
    gasLimit: "150000",
  });
}

main()
  .then(() => {
    console.log("\nDeployment completed successfully ✓");
    process.exit(0);
  })
  .catch((error) => {
    console.log("\nDeployment failed ✗");
    console.error(error);
    process.exit(1);
  });
