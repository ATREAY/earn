import axios from 'axios';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getToken } from 'next-auth/jwt';

import {
  DeadlineExtendedTemplate,
  getUnsubEmails,
  kashEmail,
  rateLimitedPromiseAll,
  resend,
} from '@/features/emails';
import { prisma } from '@/prisma';

export default async function bounty(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const params = req.query;
  const id = params.id as string;
  const { hackathonSlug, hackathonSponsor, ...updatedData } = req.body;

  try {
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

    const currentBounty = await prisma.bounties.findUnique({
      where: { id },
    });

    if (!user) {
      return res
        .status(403)
        .json({ error: 'User does not have a current sponsor.' });
    }

    if (!hackathonSlug) {
      if (!user.currentSponsorId) {
        return res
          .status(403)
          .json({ error: 'User does not have a current sponsor.' });
      }
    } else if (hackathonSlug) {
      if (!user.hackathonId) {
        return res
          .status(403)
          .json({ error: 'User does not have a current sponsor.' });
      }
    }

    if (!currentBounty) {
      return res
        .status(404)
        .json({ message: `Bounty with id=${id} not found.` });
    }

    const unsubscribedEmails = await getUnsubEmails();

    const newRewardsCount = Object.keys(updatedData.rewards || {}).length;
    const currentTotalWinners = currentBounty.totalWinnersSelected || 0;

    if (newRewardsCount < currentTotalWinners) {
      updatedData.totalWinnersSelected = newRewardsCount;

      const positions = ['first', 'second', 'third', 'fourth', 'fifth'];
      const positionsToReset = positions.slice(newRewardsCount);

      for (const position of positionsToReset) {
        await prisma.submission.updateMany({
          where: {
            listingId: id,
            isWinner: true,
            winnerPosition: position,
          },
          data: {
            isWinner: false,
            winnerPosition: null,
          },
        });
      }
    }

    let hackathonId;
    if (hackathonSlug && user.hackathonId) {
      const hackathon = await prisma.hackathon.findUnique({
        where: { id: user.hackathonId },
      });

      if (!hackathon) {
        return res.status(404).json({ error: 'Hackathon not found.' });
      }

      hackathonId = hackathon.id;
    }

    const sponsorId = hackathonId ? hackathonSponsor : user.currentSponsorId;
    const result = await prisma.bounties.update({
      where: { id, sponsorId },
      data: {
        sponsorId,
        ...(hackathonId && { hackathonId }),
        ...updatedData,
      },
    });

    const deadlineChanged = currentBounty.deadline !== updatedData.deadline;

    if (deadlineChanged) {
      const subscribers = await prisma.subscribeBounty.findMany({
        where: {
          bountyId: id,
        },
        include: {
          User: true,
        },
      });
      const filteredSubscribers = subscribers.filter(
        (subscriber) => !unsubscribedEmails.includes(subscriber.User.email),
      );
      const sendEmail = async (
        subscriber: (typeof filteredSubscribers)[number],
      ) => {
        return resend.emails.send({
          from: kashEmail,
          to: subscriber.User.email,
          subject: 'Listing Deadline Extended!',
          react: DeadlineExtendedTemplate({
            listingName: result.title,
            link: `https://earn.superteam.fun/listings/${result.type}/${result.slug}/`,
          }),
        });
      };
      await rateLimitedPromiseAll(filteredSubscribers, 5, sendEmail);
    }
    if (process.env.NEXT_PUBLIC_VERCEL_ENV === 'production') {
      const zapierWebhookUrl = process.env.ZAPIER_BOUNTY_WEBHOOK!;
      await axios.post(zapierWebhookUrl, result);
    }

    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({
      error,
      message: `Error occurred while updating bounty with id=${id}.`,
    });
  }
}
