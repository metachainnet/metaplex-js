import { Keypair, PublicKey } from '@solana/web3.js';
import { getMinimumBalanceForRentExemptMint, getAssociatedTokenAddress } from '@solana/spl-token';
import { bignum } from '@metaplex-foundation/beet';
import { Metaplex } from '@/Metaplex';
import { createNftBuilder } from '../transactionBuilders';
import { MetadataAccount, MasterEditionAccount, DataV2 } from '@/programs/tokenMetadata';
import { Creator, Collection, Uses } from '@/programs/tokenMetadata/generated';
import { Signer } from '@/utils';
import { JsonMetadata } from '../models/JsonMetadata';

export interface CreateNftParams {
  // Data.
  name?: string;
  symbol?: string;
  uri?: string;
  metadata?: JsonMetadata;
  sellerFeeBasisPoints?: number;
  creators?: Creator[];
  collection?: Collection;
  uses?: Uses;
  isMutable?: boolean;
  maxSupply?: bignum;
  allowHolderOffCurve?: boolean;

  // Signers.
  mint?: Signer;
  payer?: Signer;
  mintAuthority?: Signer;
  updateAuthority?: Signer;

  // Public keys.
  owner?: PublicKey;
  freezeAuthority?: PublicKey;

  // Programs.
  tokenProgram?: PublicKey;
  associatedTokenProgram?: PublicKey;
}

export interface CreateNftResult {
  mint: Signer;
  metadata: PublicKey;
  masterEdition: PublicKey;
  associatedToken: PublicKey;
  transactionId: string;
}

export const createNft = async (
  metaplex: Metaplex,
  params: CreateNftParams
): Promise<CreateNftResult> => {
  const {
    isMutable,
    maxSupply,
    allowHolderOffCurve = false,
    mint = Keypair.generate(),
    payer = metaplex.identity(),
    mintAuthority = payer,
    updateAuthority = mintAuthority,
    owner = mintAuthority.publicKey,
    freezeAuthority,
    tokenProgram,
    associatedTokenProgram,
  } = params;

  const [uri, metadata] = await resolveUriAndJson(metaplex, params);
  const data = resolveData(params, uri, metadata, updateAuthority.publicKey);

  const metadataPda = await MetadataAccount.pda(mint.publicKey);
  const masterEditionPda = await MasterEditionAccount.pda(mint.publicKey);
  const lamports = await getMinimumBalanceForRentExemptMint(metaplex.connection);
  const associatedToken = await getAssociatedTokenAddress(
    mint.publicKey,
    owner,
    allowHolderOffCurve,
    tokenProgram,
    associatedTokenProgram
  );

  const transactionId = await metaplex.sendAndConfirmTransaction(
    createNftBuilder({
      lamports,
      data,
      isMutable,
      maxSupply,
      mint,
      payer,
      mintAuthority,
      updateAuthority,
      owner,
      associatedToken,
      freezeAuthority,
      metadata: metadataPda,
      masterEdition: masterEditionPda,
      tokenProgram,
      associatedTokenProgram,
    })
  );

  return {
    transactionId,
    mint,
    metadata: metadataPda,
    masterEdition: masterEditionPda,
    associatedToken,
  };
};

const resolveUriAndJson = async (
  metaplex: Metaplex,
  params: CreateNftParams
): Promise<[string, JsonMetadata]> => {
  if (params.uri) {
    const metadata: JsonMetadata = await metaplex.storage().downloadJson(params.uri);

    return [params.uri, metadata];
  }

  if (params.metadata) {
    const uri = await metaplex.storage().uploadJson(params.metadata);

    return [uri, params.metadata];
  }

  const metadata: JsonMetadata = {
    name: params.name,
    symbol: params.symbol,
    seller_fee_basis_points: params.sellerFeeBasisPoints,
    properties: {
      creators: params.creators?.map((creator) => ({
        address: creator.address.toBase58(),
        share: creator.share,
      })),
    },
  };

  const uri = await metaplex.storage().uploadJson(metadata);

  return [uri, metadata];
};

const resolveData = (
  params: CreateNftParams,
  uri: string,
  metadata: JsonMetadata,
  updateAuthority: PublicKey
): DataV2 => {
  const metadataCreators: Creator[] | undefined = metadata.properties?.creators
    ?.filter((creator) => creator.address)
    .map((creator) => ({
      address: new PublicKey(creator.address as string),
      share: creator.share ?? 0,
      verified: false,
    }));

  let creators = params.creators ?? metadataCreators ?? null;

  if (creators === null) {
    creators = [
      {
        address: updateAuthority,
        share: 100,
        verified: true,
      },
    ];
  } else {
    creators = creators.map((creator) => {
      if (creator.address.toBase58() === updateAuthority.toBase58()) {
        return { ...creator, verified: true };
      } else {
        return creator;
      }
    });
  }

  return {
    name: params.name ?? metadata.name ?? '',
    symbol: params.symbol ?? metadata.symbol ?? '',
    uri,
    sellerFeeBasisPoints: params.sellerFeeBasisPoints ?? metadata.seller_fee_basis_points ?? 500,
    creators,
    collection: params.collection ?? null,
    uses: params.uses ?? null,
  };
};
