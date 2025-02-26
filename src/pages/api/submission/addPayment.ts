import type { NextApiRequest, NextApiResponse } from 'next';
import { getToken } from 'next-auth/jwt';

import { kashEmail, PaymentReceivedTemplate, resend } from '@/features/emails';
import { prisma } from '@/prisma';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const token = await getToken({ req });

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const userId = token.id;

  if (!userId) {
    return res.status(400).json({ error: 'Invalid token' });
  }

  const user = await prisma.user.findUnique({
    where: {
      id: userId as string,
    },
  });

  if (!user) {
    return res.status(400).json({ error: 'Unauthorized' });
  }

  const { id, amount, isPaid, paymentDetails } = req.body;
  try {
    const currentSubmission = await prisma.submission.findUnique({
      where: { id },
      include: { listing: true, user: true },
    });

    if (!currentSubmission) {
      return res.status(404).json({
        message: `Submission with ID ${id} not found.`,
      });
    }

    if (user.currentSponsorId !== currentSubmission.listing.sponsorId) {
      return res.status(403).json({
        message: 'Unauthorized',
      });
    }

    const result = await prisma.submission.update({
      where: {
        id,
      },
      data: {
        isPaid,
        paymentDetails,
      },
    });
    const bountyId = result.listingId;
    const updatedBounty = {
      totalPaymentsMade: {},
    };
    if (isPaid) {
      updatedBounty.totalPaymentsMade = {
        increment: 1,
      };

      const email = currentSubmission.user.email;
      const name = currentSubmission.user.firstName;

      const template = PaymentReceivedTemplate({
        name,
        amount,
        tokenName: currentSubmission.listing.token,
        walletAddress: currentSubmission.user.publicKey,
        username: currentSubmission.user.username,
      });

      await resend.emails.send({
        from: kashEmail,
        to: [email],
        subject: `Payment Confirmation for ${currentSubmission.listing.title}`,
        react: template,
      });
    }
    await prisma.bounties.update({
      where: {
        id: bountyId,
      },
      data: {
        ...updatedBounty,
      },
    });
    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({
      error,
      message: `Error occurred while updating payment of a submission ${id}.`,
    });
  }
}
