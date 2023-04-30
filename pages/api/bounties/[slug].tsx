import type { NextApiRequest, NextApiResponse } from 'next';

import { prisma } from '@/prisma';

export default async function user(req: NextApiRequest, res: NextApiResponse) {
  const params = req.query;
  const slug = params.slug as string;
  try {
    const result = await prisma.bounties.findUnique({
      where: {
        slug,
      },
      include: { sponsor: true, poc: true },
    });
    res.status(200).json(result);
  } catch (error) {
    res.status(403).json({
      error,
      message: `Error occurred while fetching bounty with slug=${slug}.`,
    });
  }
}
